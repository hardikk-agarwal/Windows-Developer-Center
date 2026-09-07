/* Windows Developer Center — local backend.
   Serves the static site AND a real signature-verification API that shells out
   to PowerShell's Get-AuthenticodeSignature. No external dependencies.

   Run:  node server.js     →  http://127.0.0.1:8090/portal.html
*/
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ROOT = __dirname;
const PORT = process.env.PORT || 8090;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".bin": "application/octet-stream", ".map": "application/json"
};

// PowerShell that inspects a file: certificate file → X509 details;
// otherwise → Authenticode signer + status. Reads the path from $env:TDP_FILE
// so no untrusted text is interpolated into the command.
const PS = [
  "$ErrorActionPreference='Stop'",
  "$f=$env:TDP_FILE",
  "$ext=[IO.Path]::GetExtension($f).ToLower()",
  "$r=$null",
  "if('.cer','.crt','.pem','.der' -contains $ext){ try{ $c=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new($f); $r=[pscustomobject]@{kind='certificate';status='Imported';signerSubject=$c.Subject;signerThumbprint=$c.Thumbprint;issuer=$c.Issuer;notAfter=$c.NotAfter.ToString('o');timeStamped=$false} }catch{} }",
  "if($null -eq $r){ $sig=Get-AuthenticodeSignature -FilePath $f; $sc=$sig.SignerCertificate; $r=[pscustomobject]@{kind='authenticode';status=$sig.Status.ToString();statusMessage=$sig.StatusMessage;signerSubject= if($sc){$sc.Subject}else{$null};signerThumbprint= if($sc){$sc.Thumbprint}else{$null};issuer= if($sc){$sc.Issuer}else{$null};notAfter= if($sc){$sc.NotAfter.ToString('o')}else{$null};timeStamped=[bool]$sig.TimeStamperCertificate} }",
  "$r | Add-Member -NotePropertyName fileSha256 -NotePropertyValue ((Get-FileHash $f -Algorithm SHA256).Hash) -PassThru | ConvertTo-Json -Compress"
].join("; ");

function verifyFile(filePath) {
  return new Promise(function (resolve, reject) {
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", PS],
      { env: Object.assign({}, process.env, { TDP_FILE: filePath }), timeout: 25000, maxBuffer: 1 << 20 },
      function (err, stdout) {
        if (err) return reject(err);
        try { resolve(JSON.parse((stdout || "").trim() || "{}")); }
        catch (e) { reject(e); }
      });
  });
}

// Local discovery covers Start Menu apps and running executables, not the production telemetry catalog.
// High-res (256px jumbo) icon extraction via the shell image list — so app logos
// stay crisp in the publishing flow's 64px banner (ExtractAssociatedIcon is only 32px).
const ICO_CS = `using System;using System.Drawing;using System.Runtime.InteropServices;public class Ico{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]struct SHFILEINFO{public IntPtr hIcon;public int iIcon;public uint dwAttributes;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string szDisplayName;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)]public string szTypeName;}[DllImport("shell32.dll",CharSet=CharSet.Auto)]static extern IntPtr SHGetFileInfo(string p,uint a,ref SHFILEINFO s,uint c,uint f);[DllImport("shell32.dll",EntryPoint="#727")]static extern int SHGetImageList(int i,ref Guid r,out IImageList l);[ComImport,Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IImageList{[PreserveSig]int Add(IntPtr a,IntPtr b,ref int c);[PreserveSig]int ReplaceIcon(int a,IntPtr b,ref int c);[PreserveSig]int SetOverlayImage(int a,int b);[PreserveSig]int Replace(int a,IntPtr b,IntPtr c);[PreserveSig]int AddMasked(IntPtr a,int b,ref int c);[PreserveSig]int Draw(ref IntPtr a);[PreserveSig]int Remove(int a);[PreserveSig]int GetIcon(int a,int b,ref IntPtr c);}public static Bitmap Get(string path){SHFILEINFO sh=new SHFILEINFO();SHGetFileInfo(path,(uint)0,ref sh,(uint)Marshal.SizeOf(sh),(uint)0x4000);Guid g=new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");IImageList il;SHGetImageList(4,ref g,out il);IntPtr h=IntPtr.Zero;il.GetIcon(sh.iIcon,1,ref h);return Icon.FromHandle(h).ToBitmap();}}`;
const PS_APPS = [
  "$ErrorActionPreference='SilentlyContinue'",
  // 1) Collect unique Start Menu .exe targets (fast; COM shortcut resolve, no signature yet).
  "$sh=New-Object -ComObject WScript.Shell",
  "$dirs=@((Join-Path $env:ProgramData 'Microsoft/Windows/Start Menu/Programs'),(Join-Path $env:AppData 'Microsoft/Windows/Start Menu/Programs'))",
  "$seen=@{}; $targets=@()",
  "foreach($d in $dirs){ Get-ChildItem -Path $d -Recurse -Filter *.lnk | ForEach-Object { $t=$sh.CreateShortcut($_.FullName).TargetPath; if($t -and $t.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $t) -and -not $seen[$t.ToLower()]){ $seen[$t.ToLower()]=$true; $targets += [pscustomobject]@{ name=$_.BaseName; path=$t; hasStartMenuEntry=$true } } } }",
  "Get-CimInstance Win32_Process | ForEach-Object { $t=$_.ExecutablePath; if($t -and $t.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $t) -and -not $seen[$t.ToLower()]){ $seen[$t.ToLower()]=$true; $targets += [pscustomobject]@{ name=$_.Name; path=$t; hasStartMenuEntry=$false } } }",
  // 2) Match by SIGNER cert thumbprint IN PARALLEL. CreateFromSignedFile reads the embedded
  //    signer cert directly (no chain build / no revocation / no network) => ~10ms vs ~200ms+
  //    for Get-AuthenticodeSignature. Discovery only needs \"who signed it\", not full trust validation.
  "$tp=$env:TDP_THUMB",
  "$matches=@($targets | ForEach-Object -ThrottleLimit 16 -Parallel { try{ $c=[System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($_.path); if($c -and $c.GetCertHashString().ToUpper() -eq $using:tp){ $_ } }catch{} })",
  // 3) Icon (256px jumbo) + version info for the FEW matched exes only.
  "Add-Type -AssemblyName System.Drawing",
  "$cs = '" + ICO_CS + "'",
  "try{ Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing.Common -ErrorAction Stop }catch{}",
  "function IcoB64($p){ $b=$null; try{ $b=[Ico]::Get($p) }catch{ try{ $b=[System.Drawing.Icon]::ExtractAssociatedIcon($p).ToBitmap() }catch{} }; if($null -eq $b){ return '' }; try{ $m=New-Object IO.MemoryStream; $b.Save($m,[System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); [Convert]::ToBase64String($m.ToArray()) }catch{ '' } }",
  "$out=@(); foreach($mm in $matches){ $fi=Get-Item -LiteralPath $mm.path; $vi=$fi.VersionInfo; $out += [pscustomobject]@{ name=$mm.name; productName=if($mm.hasStartMenuEntry){$mm.name}else{$vi.ProductName}; file=$fi.Name; version=$vi.ProductVersion; publisher=$vi.CompanyName; hasStartMenuEntry=$mm.hasStartMenuEntry; sizeKB=[math]::Round($fi.Length/1KB); icon=(IcoB64 $mm.path); path=$mm.path; totalEngagementDurationMS=$null } }",
  "$out | ConvertTo-Json -Compress"
].join("; ");

var appsByCertCache = Object.create(null); // thumb -> { t, data }; 5-min TTL (the scan is expensive)
function appsByCert(thumb) {
  var hit = appsByCertCache[thumb];
  if (hit && (Date.now() - hit.t) < 300000) return Promise.resolve(hit.data);
  return new Promise(function (resolve, reject) {
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", PS_APPS],
      { env: Object.assign({}, process.env, { TDP_THUMB: thumb }), timeout: 45000, maxBuffer: 8 << 20 },
      function (err, stdout) {
        if (err) return reject(err);
        var data;
        try { data = JSON.parse((stdout || "").trim() || "[]"); } catch (e) { data = []; }
        if (!Array.isArray(data)) data = data ? [data] : [];
        appsByCertCache[thumb] = { t: Date.now(), data: data };
        resolve(data);
      });
  });
}

function handleAppsByCert(req, res) {
  var u = new URL(req.url, "http://localhost");
  var tp = (u.searchParams.get("thumbprint") || "").toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(tp)) return sendJson(res, 400, { error: "bad thumbprint" });
  appsByCert(tp)
    .then(function (list) { sendJson(res, 200, list); })
    .catch(function (e) { sendJson(res, 500, { error: String(e && e.message || e) }); });
}

// Real crash/hang telemetry from the Windows Application event log, by exe name.
const PS_CRASH = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$f=$env:TDP_FILE",
  "$ev=Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1002} -MaxEvents 1500",
  "$m=@($ev | Where-Object { $_.Properties[0].Value -ieq $f })",
  "$cut=(Get-Date).AddDays(-30)",
  "$recent=@($m | Select-Object -First 8 | ForEach-Object { [pscustomobject]@{ time=$_.TimeCreated.ToString('o'); type= if($_.Id -eq 1002){'Hang'}else{'Crash'}; module=$_.Properties[3].Value; code=$_.Properties[6].Value } })",
  "[pscustomobject]@{ file=$f; total=$m.Count; last30=@($m | Where-Object { $_.TimeCreated -ge $cut }).Count; recent=$recent } | ConvertTo-Json -Compress -Depth 4"
].join("; ");

function crashAnalytics(file) {
  return new Promise(function (resolve, reject) {
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", PS_CRASH],
      { env: Object.assign({}, process.env, { TDP_FILE: file }), timeout: 30000, maxBuffer: 4 << 20 },
      function (err, stdout) {
        if (err) return reject(err);
        try { resolve(JSON.parse((stdout || "").trim() || "{}")); } catch (e) { resolve({ file: file, total: 0, last30: 0, recent: [] }); }
      });
  });
}

function handleCrash(req, res) {
  var u = new URL(req.url, "http://localhost");
  var file = (u.searchParams.get("file") || "").replace(/[\\/]/g, "").slice(0, 120);
  if (!file) return sendJson(res, 400, { error: "no file" });
  crashAnalytics(file)
    .then(function (d) { sendJson(res, 200, d); })
    .catch(function (e) { sendJson(res, 500, { error: String(e && e.message || e) }); });
}

// Server-side link preview: fetch a page and pull its Open Graph image / title / description +
// favicon, so the client never calls a third-party preview service. Best-effort; returns blanks
// on any failure (the client falls back to just the hostname).
function lpAbsUrl(maybe, base) { try { return new URL(maybe, base).href; } catch (e) { return ""; } }
function lpDecode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function lpMeta(html, key) {
  // <meta property|name="key" ... content="..."> — any attribute order.
  var esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var tag = (html.match(new RegExp('<meta[^>]*\\b(?:property|name)\\s*=\\s*["\\\']' + esc + '["\\\'][^>]*>', "i")) || [])[0];
  if (!tag) return "";
  var m = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
  return m ? lpDecode(m[1]) : "";
}
function lpFavicon(html, base) {
  var tag = (html.match(/<link[^>]*\brel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i) || [])[0];
  if (tag) { var h = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i); if (h && h[1]) return lpAbsUrl(h[1], base); }
  return lpAbsUrl("/favicon.ico", base);
}
function linkPreview(target) {
  var ctrl = new AbortController();
  var to = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 7000);
  return fetch(target, {
    redirect: "follow", signal: ctrl.signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "text/html,application/xhtml+xml" }
  }).then(function (r) {
    return r.text().then(function (full) {
      var html = full.slice(0, 512 * 1024);   // OG tags live in <head>
      var finalUrl = r.url || target;
      var title = lpMeta(html, "og:title") || lpMeta(html, "twitter:title");
      if (!title) { var t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title = t ? lpDecode(t[1]) : ""; }
      var image = lpMeta(html, "og:image") || lpMeta(html, "og:image:url") || lpMeta(html, "twitter:image") || lpMeta(html, "twitter:image:src");
      var desc = lpMeta(html, "og:description") || lpMeta(html, "twitter:description") || lpMeta(html, "description");
      return { url: finalUrl, title: title, description: desc, image: image ? lpAbsUrl(image, finalUrl) : "", logo: lpFavicon(html, finalUrl) };
    });
  }).finally(function () { clearTimeout(to); });
}
function lpIsPrivateHost(h) {
  h = (h || "").toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}
function handleLinkPreview(req, res) {
  var u = new URL(req.url, "http://localhost");
  var target = u.searchParams.get("url") || "";
  var parsed;
  try { parsed = new URL(target); } catch (e) { return sendJson(res, 400, { error: "bad url" }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return sendJson(res, 400, { error: "bad protocol" });
  if (lpIsPrivateHost(parsed.hostname)) return sendJson(res, 400, { error: "blocked host" });
  linkPreview(parsed.href)
    .then(function (d) { sendJson(res, 200, d); })
    .catch(function () { sendJson(res, 200, { url: parsed.href, title: "", description: "", image: "", logo: "" }); });
}

// Server-side web app manifest read (PWA Builder–style): fetch the page, find its
// <link rel="manifest">, fetch + parse it, and resolve icon/screenshot URLs. No CORS, so
// this is the reliable path whenever the Node server is running; the client falls back to
// public CORS proxies on the static deploy. Returns the same shape the client builds itself.
function wmFetchText(target) {
  var ctrl = new AbortController();
  var to = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000);
  return fetch(target, {
    redirect: "follow", signal: ctrl.signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/json,*/*" }
  }).then(function (r) { return r.text().then(function (t) { return { url: r.url || target, ok: r.ok, body: t || "" }; }); })
    .finally(function () { clearTimeout(to); });
}
function wmHref(html, re) { var tag = (html.match(re) || [])[0] || ""; var m = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i); return m ? m[1] : ""; }
function webManifest(pageUrl) {
  return wmFetchText(pageUrl).then(function (page) {
    var html = (page.body || "").slice(0, 512 * 1024);
    var finalUrl = page.url || pageUrl;
    var href = wmHref(html, /<link[^>]*\brel\s*=\s*["']?[^"'>]*manifest[^"'>]*["']?[^>]*>/i);
    var step = href
      ? wmFetchText(lpAbsUrl(href, finalUrl)).then(function (mf) {
          var man = {}; try { man = JSON.parse((mf.body || "").replace(/^﻿/, "")); } catch (e) {}
          return { manifest: man, base: mf.url || finalUrl };
        }).catch(function () { return { manifest: {}, base: finalUrl }; })
      : Promise.resolve({ manifest: {}, base: finalUrl });
    return step.then(function (r) {
      var man = r.manifest || {}, base = r.base || finalUrl;
      var icons = (Array.isArray(man.icons) ? man.icons : [])
        .map(function (ic) { return { src: lpAbsUrl(ic.src || "", base), sizes: ic.sizes || "", purpose: ic.purpose || "" }; })
        .filter(function (ic) { return ic.src; });
      var shots = (Array.isArray(man.screenshots) ? man.screenshots : [])
        .map(function (s) { return lpAbsUrl(s.src || "", base); }).filter(Boolean);
      var ogImage = lpMeta(html, "og:image") || lpMeta(html, "twitter:image");
      return {
        name: lpDecode(man.name || man.short_name || lpMeta(html, "og:title") || ""),
        shortName: lpDecode(man.short_name || ""),
        description: lpDecode(man.description || lpMeta(html, "description") || lpMeta(html, "og:description") || ""),
        categories: Array.isArray(man.categories) ? man.categories : [],
        themeColor: man.theme_color || "",
        icons: icons, screenshots: shots,
        appleIcon: lpAbsUrl(wmHref(html, /<link[^>]*\brel\s*=\s*["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i), finalUrl),
        ogImage: ogImage ? lpAbsUrl(ogImage, finalUrl) : "",
        hadManifest: !!href
      };
    });
  });
}
function handleWebManifest(req, res) {
  var u = new URL(req.url, "http://localhost");
  var target = u.searchParams.get("url") || "";
  var parsed;
  try { parsed = new URL(target); } catch (e) { return sendJson(res, 400, { error: "bad url" }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return sendJson(res, 400, { error: "bad protocol" });
  if (lpIsPrivateHost(parsed.hostname)) return sendJson(res, 400, { error: "blocked host" });
  webManifest(parsed.href)
    .then(function (d) { sendJson(res, 200, d); })
    .catch(function () { sendJson(res, 200, { name: "", shortName: "", description: "", categories: [], themeColor: "", icons: [], screenshots: [], appleIcon: "", ogImage: "", hadManifest: false }); });
}

// ---------------------------------------------------------------------------
// Azure AI proxy. Keeps the Foundry key server-side so AI works for every user
// of a deployment WITHOUT shipping the key to git or the browser. Credentials
// come from environment variables (preferred for hosting); locally they fall
// back to the gitignored publishing/ai-config.js so dev "just works".
// The client (ai-client.js) calls /api/ai/status to detect availability, then
// POSTs to /api/ai/responses and /api/ai/images. Restart the server after
// changing credentials.
// ---------------------------------------------------------------------------
function readAiCreds() {
  var c = {
    endpoint:      process.env.AZURE_AI_ENDPOINT       || "",
    apiKey:        process.env.AZURE_AI_KEY             || "",
    model:         process.env.AZURE_AI_MODEL           || "",
    imageEndpoint: process.env.AZURE_AI_IMAGE_ENDPOINT  || "",
    imageModel:    process.env.AZURE_AI_IMAGE_MODEL     || "",
  };
  if (!c.endpoint || !c.apiKey || !c.model) {
    try {
      var txt = fs.readFileSync(path.join(ROOT, "publishing", "ai-config.js"), "utf8");
      var shim = {};
      new Function("window", txt)(shim);            // ai-config.js only sets window.AI_CONFIG
      var w = shim.AI_CONFIG || {};
      c.endpoint      = c.endpoint      || w.endpoint      || "";
      c.apiKey        = c.apiKey        || w.apiKey        || "";
      c.model         = c.model         || w.model         || "";
      c.imageEndpoint = c.imageEndpoint || w.imageEndpoint || "";
      c.imageModel    = c.imageModel    || w.imageModel    || "";
    } catch (e) { /* no local config — proxy stays disabled, client uses heuristics */ }
  }
  return c;
}
var AI_CREDS = readAiCreds();
var AI_READY = !!(AI_CREDS.endpoint && AI_CREDS.apiKey && AI_CREDS.model);
var AI_IMG_READY = !!(AI_CREDS.imageEndpoint && AI_CREDS.apiKey && AI_CREDS.imageModel);

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on("data", function (d) { size += d.length; if (size > (1 << 20)) { reject(new Error("body too large")); try { req.destroy(); } catch (e) {} } else chunks.push(d); });
    req.on("end", function () { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

function handleAiStatus(req, res) {
  sendJson(res, 200, { enabled: AI_READY, imageEnabled: AI_IMG_READY });
}

// Forward a client request to Azure AI Foundry, injecting the server-held key
// and model. Response is passed straight back so the client parses it as if it
// had called Foundry directly.
function proxyAi(req, res, kind) {
  var ready    = kind === "image" ? AI_IMG_READY : AI_READY;
  var endpoint = kind === "image" ? AI_CREDS.imageEndpoint : AI_CREDS.endpoint;
  var model    = kind === "image" ? AI_CREDS.imageModel : AI_CREDS.model;
  if (!ready) return sendJson(res, 503, { error: "AI not configured on server" });
  readJsonBody(req).then(function (body) {
    body.model = model;                              // server owns the model name
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": AI_CREDS.apiKey },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        res.writeHead(r.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(t);
      });
    });
  }).catch(function (e) {
    var msg = String(e && e.message || e);
    sendJson(res, msg === "bad json" ? 400 : 502, { error: msg });
  });
}

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}

function handleVerify(req, res) {
  var u = new URL(req.url, "http://localhost");
  var name = u.searchParams.get("name") || "upload.bin";
  var ext = path.extname(name) || ".bin";
  var tmp = path.join(os.tmpdir(), "tdp-" + crypto.randomBytes(8).toString("hex") + ext);
  var ws = fs.createWriteStream(tmp);
  req.pipe(ws);
  req.on("error", function () { try { ws.destroy(); } catch (e) {} sendJson(res, 400, { error: "upload failed" }); });
  ws.on("finish", function () {
    verifyFile(tmp)
      .then(function (r) { sendJson(res, 200, r); })
      .catch(function (e) { sendJson(res, 500, { error: String(e && e.message || e) }); })
      .then(function () { fs.unlink(tmp, function () {}); });
  });
}

function serveStatic(req, res) {
  var u = new URL(req.url, "http://localhost");
  var rel = decodeURIComponent(u.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  var filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      // Dev prototype: always serve fresh HTML/JS/CSS so edits show on a normal reload (no stale cache).
      "Cache-Control": "no-cache, no-store, must-revalidate"
    });
    res.end(data);
  });
}

http.createServer(function (req, res) {
  if (req.method === "POST" && req.url.indexOf("/api/verify-signature") === 0) return handleVerify(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/apps-by-cert") === 0) return handleAppsByCert(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/crash-analytics") === 0) return handleCrash(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/link-preview") === 0) return handleLinkPreview(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/web-manifest") === 0) return handleWebManifest(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/ai/status") === 0) return handleAiStatus(req, res);
  if (req.method === "POST" && req.url.indexOf("/api/ai/responses") === 0) return proxyAi(req, res, "text");
  if (req.method === "POST" && req.url.indexOf("/api/ai/images") === 0) return proxyAi(req, res, "image");
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Method not allowed");
}).listen(PORT, "127.0.0.1", function () {
  console.log("WDP portal + verification API → http://127.0.0.1:" + PORT + "/portal.html");
});
