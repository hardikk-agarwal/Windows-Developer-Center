<#
  Trusted Developer Program — real Windows code-signing flow.

  1. Compiles a real .exe
  2. Creates a self-signed CODE SIGNING certificate (CurrentUser store, no admin)
  3. Signs the .exe with Authenticode (SHA-256)
  4. Verifies the signature and prints signer + thumbprint + file hash
  5. Runs the signed app to prove it executes on Windows

  Run:  pwsh -ExecutionPolicy Bypass -File .\sign-and-verify.ps1
#>
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$src = Join-Path $dir 'HelloTDP.cs'
$exe = Join-Path $dir 'HelloTDP.exe'

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# 1) Compile a real PE executable -------------------------------------------
Section '1. Compile HelloTDP.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /out:"$exe" "$src"
if (-not (Test-Path $exe)) { throw 'Compilation failed' }
Write-Host "Compiled -> $exe" -ForegroundColor Green

$preHash = (Get-FileHash $exe -Algorithm SHA256).Hash
Write-Host "Unsigned SHA-256: $preHash"

# 2) Create a self-signed code-signing certificate --------------------------
Section '2. Create code-signing certificate'
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=Contoso Studios (TDP Demo)' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(2)
Write-Host ("Subject    : {0}" -f $cert.Subject)
Write-Host ("Issuer     : {0}" -f $cert.Issuer)
Write-Host ("Thumbprint : {0}" -f $cert.Thumbprint)   # SHA-1 cert thumbprint
Write-Host ("Valid to   : {0}" -f $cert.NotAfter)

# 3) Sign the binary --------------------------------------------------------
Section '3. Sign the binary (Authenticode, SHA-256)'
$signParams = @{ FilePath = $exe; Certificate = $cert; HashAlgorithm = 'SHA256' }
# add an RFC-3161 timestamp if a server is reachable (optional, needs internet)
try {
    $null = Invoke-WebRequest 'http://timestamp.digicert.com' -Method Head -TimeoutSec 4 -ErrorAction Stop
    $signParams.TimestampServer = 'http://timestamp.digicert.com'
    Write-Host 'Timestamp server reachable — adding RFC-3161 timestamp.'
} catch { Write-Host 'No timestamp server (offline) — signing without timestamp.' -ForegroundColor Yellow }

$signResult = Set-AuthenticodeSignature @signParams
Write-Host ("Signing status: {0}" -f $signResult.Status) -ForegroundColor Green

# 4) Verify -----------------------------------------------------------------
Section '4. Verify the signature'
$sig = Get-AuthenticodeSignature -FilePath $exe
$postHash = (Get-FileHash $exe -Algorithm SHA256).Hash
[pscustomobject]@{
    Status            = $sig.Status
    StatusMessage     = $sig.StatusMessage
    SignerSubject     = $sig.SignerCertificate.Subject
    SignerThumbprint  = $sig.SignerCertificate.Thumbprint
    TimeStamped       = [bool]$sig.TimeStamperCertificate
    SignedFileSHA256  = $postHash
} | Format-List

Write-Host "Note: file SHA-256 changed after signing (signature embedded in the PE):" -ForegroundColor DarkGray
Write-Host "  before: $preHash"
Write-Host "  after : $postHash"

# 5) Run it -----------------------------------------------------------------
Section '5. Run the signed app'
& $exe

Write-Host "`nDone. To remove the demo cert later:" -ForegroundColor DarkGray
Write-Host "  Remove-Item 'Cert:\CurrentUser\My\$($cert.Thumbprint)'" -ForegroundColor DarkGray
