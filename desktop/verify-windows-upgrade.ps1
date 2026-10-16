# Targeted disposable-runner upgrade regression. No real client settings or data.
param([Parameter(Mandatory=$true)][string]$Installation, [Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if (-not $env:CI) { throw 'Requires a disposable CI runner' }
$gate = Join-Path $PSScriptRoot 'src-tauri/windows/prepare-upgrade.ps1'
. $gate -LibraryOnly
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$python = Join-Path $Installation 'backend/python/python.exe'
$fake = [pscustomobject]@{ExecutablePath=$python;CommandLine='"C:\Synthetic Space\python.exe" -m app.connector_mcp --credential-file synthetic.key'}
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'adapter') 'Exact adapter not recognized'
$fake.CommandLine='python.exe -c "print(''-m app.connector_mcp'')"'
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'writer') 'Command string confused with module mode'
$fake.CommandLine='python.exe -m app.connector_mcp_other'
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'writer') 'Other module eligible for termination'
$fake.ExecutablePath="$Installation-other\backend\python\python.exe"
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'outside') 'Other installation eligible for termination'
$temp = Join-Path $env:RUNNER_TEMP 'ripple-synthetic-upgrade-client'
New-Item $temp -ItemType Directory -Force | Out-Null
$key = Join-Path $temp 'synthetic.key'
[IO.File]::WriteAllText($key,('synthetic-upgrade-credential-' + ('x'*40)))
function Start-SyntheticPython([string]$Arguments) {
 $start = [Diagnostics.ProcessStartInfo]::new($python, $Arguments)
 $start.UseShellExecute=$false; $start.CreateNoWindow=$true
 $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
 $start.EnvironmentVariables['PYTHONPATH']="$Installation/backend/backend;$Installation/backend/site-packages"
 $start.EnvironmentVariables['PYTHONDONTWRITEBYTECODE']='1'
 $process=[Diagnostics.Process]::Start($start)
 return $process
}
$exe = Join-Path $Installation 'ripple-desktop.exe'
$before = (Get-FileHash $exe).Hash
$sentinel = Join-Path $Installation 'build-info.json'
$originalInfo = [IO.File]::ReadAllText($sentinel)
[IO.File]::WriteAllText($sentinel, '{"syntheticUpgradeSentinel":true}')
function Assert-BlockedInstaller {
 $attempt=Start-Process $Installer -ArgumentList "/S /UPDATE /D=$Installation" -Wait -PassThru
 Assert ($attempt.ExitCode -ne 0) 'Unsafe silent upgrade was allowed'
 Assert ([IO.File]::ReadAllText($sentinel) -eq '{"syntheticUpgradeSentinel":true}') 'Unsafe upgrade replaced resources'
}
# Potential writer: preflight must fail without ending it or changing installed bytes.
$writer=Start-SyntheticPython '-c "import asyncio,time;time.sleep(120)"'
try {
 Start-Sleep -Milliseconds 500
 $blocked=$false
 try { Invoke-RippleUpgradeGate $Installation } catch { $blocked=$true }
 Assert $blocked 'Potential writer was not blocked'
 Assert-BlockedInstaller
 Assert (-not $writer.HasExited) 'Potential writer was terminated'
 Assert ((Get-FileHash $exe).Hash -eq $before) 'Blocked preflight modified installation'
} finally { if(-not $writer.HasExited){$writer.Kill();$writer.WaitForExit()};$writer.Dispose() }
# Unknown file lock: fail before any replacement; releasing it allows retry.
$modules = @(Get-ChildItem (Join-Path $Installation 'backend/python') -Recurse -Filter '_asyncio.pyd')
Assert ($modules.Count -eq 1) 'Expected one bundled asyncio module'
$locked=$modules[0].FullName
$stream=[IO.File]::Open($locked,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
 $blocked=$false
 try { Invoke-RippleUpgradeGate $Installation } catch { $blocked=$true;Assert ($_.Exception.Message -match '_asyncio.pyd') 'Locked resource not identified' }
 Assert $blocked 'Unknown file lock was ignored'
 Assert-BlockedInstaller
 Assert ((Get-FileHash $exe).Hash -eq $before) 'Locked preflight modified installation'
} finally { $stream.Dispose() }
Invoke-RippleUpgradeGate $Installation
# Reproduce client-owned adapter loading _asyncio.pyd while the editor is closed.
$adapter=Start-SyntheticPython "-m app.connector_mcp --credential-file `"$key`""
try {
 $loaded=$false
 for($i=0;$i -lt 60;$i++) {
  $adapter.Refresh()
  if($adapter.HasExited){throw 'Synthetic adapter exited before upgrade'}
  try { $loaded=@($adapter.Modules | Where-Object { $_.ModuleName -ieq '_asyncio.pyd' }).Count -gt 0 } catch { }
  if($loaded){break};Start-Sleep -Milliseconds 250
 }
 if (-not $loaded) {
  $moduleNames = @($adapter.Modules | Where-Object { $_.ModuleName -match 'python|asyncio|\.pyd$' } | ForEach-Object { $_.ModuleName }) -join ', '
  throw "Adapter did not load the reported locked module; observed: $moduleNames"
 }
 $upgrade=Start-Process $Installer -ArgumentList "/S /UPDATE /D=$Installation" -Wait -PassThru
 Assert ($upgrade.ExitCode -eq 0) 'Upgrade failed with live adapter'
 Assert ($adapter.WaitForExit(5000)) 'Owned adapter was not released'
 Assert (Test-Path $exe) 'Upgrade lost the desktop executable'
 Assert ([IO.File]::ReadAllText($sentinel) -eq $originalInfo) 'Safe retry did not replace the old resource'
} finally {if(-not $adapter.HasExited){$adapter.Kill();$adapter.WaitForExit()};$adapter.Dispose()}
@{writerRefused=$true;unknownLockRefused=$true;retryAfterRelease=$true;adapterAsyncioLoaded=$true;
 upgradeWithAdapter=$true;otherInstallationExcluded=$true;commandStringExcluded=$true;
 externalClientAutoReconnect='pending real Claude/WorkBuddy acceptance'} | ConvertTo-Json
