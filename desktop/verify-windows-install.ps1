# Disposable Windows build-runner smoke test. Never use against a daily install.
$ErrorActionPreference = 'Stop'
if (-not $env:CI) { throw 'This installer smoke test requires a disposable CI runner' }
$port = 18701
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw 'The backend port is already occupied; refusing to disturb its owner'
}
$installers = @(Get-ChildItem "$PSScriptRoot/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe")
if ($installers.Count -ne 1) { throw 'Expected exactly one generated installer' }
$destination = Join-Path $env:RUNNER_TEMP 'Ripple Synthetic Installation 中文'
if (Test-Path $destination) { throw 'Refusing to overwrite an existing installation' }
$installer = Start-Process $installers[0].FullName -ArgumentList "/S /D=$destination" -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Installer failed: $($installer.ExitCode)" }
$executables = @(Get-ChildItem $destination -Filter '*.exe' | Where-Object { $_.Name -notmatch 'uninstall' })
if ($executables.Count -ne 1) { throw 'Expected exactly one installed desktop executable' }
$exe = $executables[0].FullName
$bytes = [IO.File]::ReadAllBytes($exe)
$pe = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt16($bytes, $pe + 4) -ne 0x8664) { throw 'Installed desktop binary is not x64' }
$infoFile = Join-Path $env:RUNNER_TEMP 'ripple-build-info.json'
$infoProcess = Start-Process $exe -ArgumentList '--ripple-build-info' -RedirectStandardOutput $infoFile -Wait -PassThru
$info = Get-Content $infoFile -Raw | ConvertFrom-Json
if ($infoProcess.ExitCode -ne 0 -or -not $info.custom_protocol -or $info.debug -or
    $info.commit -ne $env:RIPPLE_SOURCE_COMMIT -or $info.build -ne $env:RIPPLE_BUILD_NUMBER -or
    $info.version -ne $env:RIPPLE_APP_VERSION) { throw 'Installed build metadata does not match its source' }
$resourceInfo = Get-Content "$destination/build-info.json" -Raw | ConvertFrom-Json
if ($resourceInfo.commit -ne $info.commit) { throw 'Resource and executable provenance disagree' }
if (Test-Path "$destination/backend/data") { throw 'Staging probe data must not ship' }
if (-not (Test-Path "$destination/backend/python/python.exe")) { throw 'Bundled Python missing' }
& "$destination/backend/python/python.exe" -B "$PSScriptRoot/stage-backend.py" --check-clean "$destination/backend"
if ($LASTEXITCODE) { throw 'Installed backend contains build caches or probe data' }
$artifact = "$PSScriptRoot/dist/windows-artifact"
New-Item $artifact -ItemType Directory -Force | Out-Null
& "$PSScriptRoot/verify-windows-upgrade.ps1" -Installation $destination -Installer $installers[0].FullName | Set-Content "$artifact/upgrade-verification.json" -Encoding utf8
if ($LASTEXITCODE) { throw 'Targeted safe-upgrade verification failed' }
& "$destination/backend/python/python.exe" "$PSScriptRoot/verify-mcp-runtime.py" "$destination/backend" --output "$artifact/mcp-runtime-verification.json" --tunnel-client $env:RIPPLE_TEST_TUNNEL_CLIENT
if ($LASTEXITCODE) { throw 'Installed MCP adapter initialization, handshake or synthetic read failed' }

function Wait-Healthy {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -TimeoutSec 1
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw 'Installed backend did not become healthy'
}
function Wait-Stopped {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Installed backend survived its desktop parent'
}
$app = Start-Process $exe -PassThru
try {
    Wait-Healthy
    $app.Refresh()
    if ($app.HasExited -or $app.MainWindowHandle -eq 0) { throw 'Installed desktop window did not open' }
    if (-not $app.CloseMainWindow()) { throw 'Desktop window refused a normal close' }
    if (-not $app.WaitForExit(15000)) { throw 'Desktop did not exit normally' }
    Wait-Stopped
} finally {
    if (-not $app.HasExited) { $app.Kill(); $app.WaitForExit() }
}
$app = Start-Process $exe -PassThru
try { Wait-Healthy } finally { if (-not $app.HasExited) { $app.Kill(); $app.WaitForExit() } }
Wait-Stopped
$name = "Ripple-$($info.version)-b$($info.build)-$($info.commit.Substring(0,7))-Windows-x64-setup.exe"
Copy-Item $installers[0].FullName (Join-Path $artifact $name)
$hash = (Get-FileHash (Join-Path $artifact $name) -Algorithm SHA256).Hash.ToLower()
"$hash  $name" | Set-Content "$artifact/SHA256SUMS.txt" -Encoding utf8
@{version=$info.version;build=$info.build;commit=$info.commit;architecture='x64';runner=$env:ImageOS;
  installer=$name;sha256=$hash;releaseProtocol=$true;bundledBackendHealth=200;windowOpened=$true;
  normalExit=$true;abnormalExit=$true;syntheticUnicodeInstallPath=$true;
  noGeneratedBytecode=$true;noStagingProbeData=$true;
  windows10UserAcceptance='pending';nativeVisualAcceptance='pending'} | ConvertTo-Json | Set-Content "$artifact/build-verification.json" -Encoding utf8
