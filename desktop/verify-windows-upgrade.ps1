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
# b69 could miss a known installation when WMI omits ExecutablePath or uses a
# different Windows spelling. These comparisons must not accept another runtime.
Initialize-ProcessInspection
$fake.ExecutablePath = $python.Replace('\', '/')
$fake.CommandLine = 'python.exe -m app.connector_mcp'
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'adapter') 'Mixed path separators missed owned adapter'
$fake.ExecutablePath = '\\?\' + $python
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'adapter') 'Extended image path missed owned adapter'
$fake.CommandLine = $null
Assert ((Get-RippleProcessKind $fake $Installation) -eq 'writer') 'Missing command line qualified for termination'
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
# Exercise the exact exported Claude Node launcher, keeping a synthetic host alive
# to prove the gate stops only Python, not the client hosting the launcher.
$connectorDirectory=Join-Path $temp 'connector'
New-Item $connectorDirectory -ItemType Directory -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $connectorDirectory 'claude.key'),[IO.File]::ReadAllText($key))
$bundle=Join-Path $temp 'Ripple.mcpb'
$export=Start-SyntheticPython "-m app.connector_local export --data `"$temp`" --resources `"$Installation/backend`" --client claude --target `"$bundle`""
try { Assert ($export.WaitForExit(15000) -and $export.ExitCode -eq 0) 'Synthetic Claude export failed' }
finally { if(-not $export.HasExited){$export.Kill();$export.WaitForExit()};$export.Dispose() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($bundle)
$launcher=Join-Path $temp 'claude-launcher.cjs'
try { [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('server/index.js'),$launcher,$true) }
finally { $zip.Dispose() }
$hostScript=Join-Path $temp 'synthetic-claude-host.cjs'
[IO.File]::WriteAllText($hostScript,'require(process.argv[2]); setInterval(() => {}, 1000);')
function Start-SyntheticClaude {
 $start=[Diagnostics.ProcessStartInfo]::new((Get-Command node).Source,"`"$hostScript`" `"$launcher`"")
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 return [Diagnostics.Process]::Start($start)
}
function Find-LoadedClaudeAdapter($ClientHost) {
 for($i=0;$i -lt 60;$i++) {
  if($ClientHost.HasExited){throw 'Synthetic Claude host exited early'}
  $candidates=@(CimCmdlets\Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ClientHost.Id)" | Where-Object { (Get-RippleProcessKind $_ $Installation) -eq 'adapter' })
  if($candidates.Count -eq 1) {
   $pythonProcess=[Diagnostics.Process]::GetProcessById([int]$candidates[0].ProcessId)
   $loaded=$false
   try { $pythonProcess.Refresh();$loaded=@($pythonProcess.Modules | Where-Object {$_.ModuleName -ieq '_asyncio.pyd'}).Count -gt 0 } catch { }
   if($loaded){return $pythonProcess};$pythonProcess.Dispose()
  }
  Start-Sleep -Milliseconds 250
 }
 throw 'Exported Claude adapter did not load asyncio'
}
# Inject only the missing WMI path property. The fallback must retrieve the real
# OS image path by PID; command line, parent and creation time remain genuine.
$script:missingImagePid=0
function Get-CimInstance {
 param([string]$ClassName,[string]$Filter)
 foreach($entry in @(CimCmdlets\Get-CimInstance @PSBoundParameters)) {
  if($entry.ProcessId -eq $script:missingImagePid) {
   $copy=$entry | Select-Object Name,ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath
   $copy.ExecutablePath=$null
   $copy
  } else { $entry }
 }
}
$clientHost=Start-SyntheticClaude
$adapter=$null
try {
 $adapter=Find-LoadedClaudeAdapter $clientHost
 $script:missingImagePid=$adapter.Id
 $missing=CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId=$($adapter.Id)" | Select-Object Name,ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath
 $missing.ExecutablePath=$null
 Assert ((Get-RippleProcessKind $missing $Installation) -eq 'adapter') 'Null WMI path bypassed known adapter'
 # NSIS normally launches 32-bit Windows PowerShell. Exercise its query of this
 # live 64-bit Python too, not just the workflow's 64-bit PowerShell process.
 $crossScript=Join-Path $temp 'inspect-cross-architecture.ps1'
 [IO.File]::WriteAllText($crossScript,@'
$ErrorActionPreference='Stop'
. $env:RIPPLE_TEST_UPGRADE_GATE -LibraryOnly
$p=Get-CimInstance Win32_Process -Filter "ProcessId=$env:RIPPLE_TEST_ADAPTER_PID" | Select-Object Name,ProcessId,CreationDate,CommandLine,ExecutablePath
$p.ExecutablePath=$null
if ((Get-RippleProcessKind $p $env:RIPPLE_TEST_INSTALLATION) -ne 'adapter') { throw 'Cross-architecture null image lookup failed' }
'@)
 $start=[Diagnostics.ProcessStartInfo]::new("$env:WINDIR\SysWOW64\WindowsPowerShell\v1.0\powershell.exe","-NoLogo -NoProfile -NonInteractive -File `"$crossScript`"")
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.EnvironmentVariables['RIPPLE_TEST_UPGRADE_GATE']=$gate
 $start.EnvironmentVariables['RIPPLE_TEST_ADAPTER_PID']=[string]$adapter.Id
 $start.EnvironmentVariables['RIPPLE_TEST_INSTALLATION']=$Installation
 $cross=[Diagnostics.Process]::Start($start)
 try { Assert ($cross.WaitForExit(15000) -and $cross.ExitCode -eq 0) '32-bit process-image fallback failed' }
 finally {if(-not $cross.HasExited){$cross.Kill();$cross.WaitForExit()};$cross.Dispose()}
 Invoke-RippleUpgradeGate $Installation
 Assert ($adapter.WaitForExit(5000)) 'Null WMI image path adapter not released'
 Assert (-not $clientHost.HasExited) 'Synthetic client host was terminated'
} finally {
 $script:missingImagePid=0
 if($adapter){if(-not $adapter.HasExited){$adapter.Kill();$adapter.WaitForExit()};$adapter.Dispose()}
 if(-not $clientHost.HasExited){$clientHost.Kill();$clientHost.WaitForExit()};$clientHost.Dispose()
}
Remove-Item Function:Get-CimInstance
# Run the actual installer with the exported Claude adapter still holding asyncio.
$clientHost=Start-SyntheticClaude
$adapter=$null
try {
 $adapter=Find-LoadedClaudeAdapter $clientHost
 $upgrade=Start-Process $Installer -ArgumentList "/S /UPDATE /D=$Installation" -Wait -PassThru
 Assert ($upgrade.ExitCode -eq 0) 'Upgrade failed with exported Claude adapter'
 Assert ($adapter.WaitForExit(5000)) 'Exported Claude adapter was not released'
 Assert (-not $clientHost.HasExited) 'Upgrade terminated the synthetic client host'
 Assert (Test-Path $exe) 'Upgrade lost the desktop executable'
 Assert ([IO.File]::ReadAllText($sentinel) -eq $originalInfo) 'Safe retry did not replace the old resource'
} finally {
 if($adapter){if(-not $adapter.HasExited){$adapter.Kill();$adapter.WaitForExit()};$adapter.Dispose()}
 if(-not $clientHost.HasExited){$clientHost.Kill();$clientHost.WaitForExit()};$clientHost.Dispose()
}
@{writerRefused=$true;unknownLockRefused=$true;retryAfterRelease=$true;adapterAsyncioLoaded=$true;
 upgradeWithExportedClaudeAdapter=$true;clientHostPreserved=$true;nullWmiImageFallback=$true;
 crossArchitectureImageLookup=$true;extendedImagePath=$true;mixedImageSeparators=$true;missingCommandLineRefused=$true;
 otherInstallationExcluded=$true;commandStringExcluded=$true;
 externalClientAutoReconnect='pending real Claude/WorkBuddy acceptance'} | ConvertTo-Json
