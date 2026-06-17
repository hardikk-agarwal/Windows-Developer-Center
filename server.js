/* Windows Developer Portal — local backend.
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

// Scan INSTALLED apps (Start Menu shortcuts) for executables signed by a given
// cert thumbprint. The shortcut name is the real, user-facing app name.
// High-res (256px jumbo) icon extraction via the shell image list — so app logos
// stay crisp in the publishing flow's 64px banner (ExtractAssociatedIcon is only 32px).
const ICO_CS = `using System;using System.Drawing;using System.Runtime.InteropServices;public class Ico{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]struct SHFILEINFO{public IntPtr hIcon;public int iIcon;public uint dwAttributes;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string szDisplayName;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)]public string szTypeName;}[DllImport("shell32.dll",CharSet=CharSet.Auto)]static extern IntPtr SHGetFileInfo(string p,uint a,ref SHFILEINFO s,uint c,uint f);[DllImport("shell32.dll",EntryPoint="#727")]static extern int SHGetImageList(int i,ref Guid r,out IImageList l);[ComImport,Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IImageList{[PreserveSig]int Add(IntPtr a,IntPtr b,ref int c);[PreserveSig]int ReplaceIcon(int a,IntPtr b,ref int c);[PreserveSig]int SetOverlayImage(int a,int b);[PreserveSig]int Replace(int a,IntPtr b,IntPtr c);[PreserveSig]int AddMasked(IntPtr a,int b,ref int c);[PreserveSig]int Draw(ref IntPtr a);[PreserveSig]int Remove(int a);[PreserveSig]int GetIcon(int a,int b,ref IntPtr c);}public static Bitmap Get(string path){SHFILEINFO sh=new SHFILEINFO();SHGetFileInfo(path,(uint)0,ref sh,(uint)Marshal.SizeOf(sh),(uint)0x4000);Guid g=new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");IImageList il;SHGetImageList(4,ref g,out il);IntPtr h=IntPtr.Zero;il.GetIcon(sh.iIcon,1,ref h);return Icon.FromHandle(h).ToBitmap();}}`;
const PS_APPS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "Add-Type -AssemblyName System.Drawing",
  "$cs = '" + ICO_CS + "'",
  "try{ Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing.Common -ErrorAction Stop }catch{}",
  "function IcoB64($p){ $b=$null; try{ $b=[Ico]::Get($p) }catch{ try{ $b=[System.Drawing.Icon]::ExtractAssociatedIcon($p).ToBitmap() }catch{} }; if($null -eq $b){ return '' }; try{ $m=New-Object IO.MemoryStream; $b.Save($m,[System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); [Convert]::ToBase64String($m.ToArray()) }catch{ '' } }",
  "$tp=$env:TDP_THUMB",
  "$dirs=@((Join-Path $env:ProgramData 'Microsoft/Windows/Start Menu/Programs'),(Join-Path $env:AppData 'Microsoft/Windows/Start Menu/Programs'))",
  "$sh=New-Object -ComObject WScript.Shell",
  "$seen=@{}; $out=@()",
  "$skip='Telemetry|Language Preferences|Recording Manager|Uninstall|Readme|Read Me|Release Notes|Repair|Diagnostic|Compare|Documentation|Activation'",
  "foreach($d in $dirs){ Get-ChildItem -Path $d -Recurse -Filter *.lnk | ForEach-Object { $t=$sh.CreateShortcut($_.FullName).TargetPath; if($t -and $t.ToLower().EndsWith('.exe') -and ($_.BaseName -notmatch $skip) -and (Test-Path -LiteralPath $t) -and -not $seen[$t.ToLower()]){ $seen[$t.ToLower()]=$true; $s=Get-AuthenticodeSignature -LiteralPath $t; if($s.Status -eq 'Valid' -and $s.SignerCertificate -and $s.SignerCertificate.Thumbprint -eq $tp){ $fi=Get-Item -LiteralPath $t; $vi=$fi.VersionInfo; $out += [pscustomobject]@{ name=$_.BaseName; file=$fi.Name; version=$vi.ProductVersion; publisher=$vi.CompanyName; sizeKB=[math]::Round($fi.Length/1KB); icon=(IcoB64 $t); path=$t } } } } }",
  "$out | ConvertTo-Json -Compress"
].join("; ");

function appsByCert(thumb) {
  return new Promise(function (resolve, reject) {
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", PS_APPS],
      { env: Object.assign({}, process.env, { TDP_THUMB: thumb }), timeout: 45000, maxBuffer: 8 << 20 },
      function (err, stdout) {
        if (err) return reject(err);
        var data;
        try { data = JSON.parse((stdout || "").trim() || "[]"); } catch (e) { data = []; }
        if (!Array.isArray(data)) data = data ? [data] : [];
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
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

http.createServer(function (req, res) {
  if (req.method === "POST" && req.url.indexOf("/api/verify-signature") === 0) return handleVerify(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/apps-by-cert") === 0) return handleAppsByCert(req, res);
  if (req.method === "GET" && req.url.indexOf("/api/crash-analytics") === 0) return handleCrash(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Method not allowed");
}).listen(PORT, "127.0.0.1", function () {
  console.log("WDP portal + verification API → http://127.0.0.1:" + PORT + "/portal.html");
});
