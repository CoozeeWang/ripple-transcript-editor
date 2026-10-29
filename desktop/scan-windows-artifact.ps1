# Read-only analysis on a disposable Windows runner. Never launch the inspected installer.
param([Parameter(Mandatory=$true)][string]$ArtifactDirectory,
      [Parameter(Mandatory=$true)][string]$ReportDirectory,
      [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedSha256)
$ErrorActionPreference = 'Stop'
if (-not $env:CI) { throw 'Artifact security analysis requires a disposable CI runner' }
New-Item $ReportDirectory -ItemType Directory -Force | Out-Null
$report = @{completed=$false;verdict='unavailable';installerExecuted=$false;securitySettingsChanged=$false;
  browserVerdict='not assessed';startedAt=[DateTime]::UtcNow.ToString('o')}
function Get-DefenderStatus {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try { return Get-MpComputerStatus -ErrorAction Stop }
        catch {
            if ($attempt -eq 2) { throw }
            # A newly provisioned runner's WMI provider may not be ready yet.
            # Retry observation only; never disable protection or ignore failure.
            Start-Sleep -Seconds 2
        }
    }
}
function Wait-DefenderStatus {
    # Platform servicing can restart Defender during a signature update. Observe
    # readiness with a bound; never start/stop services or accept stale state.
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $report.defenderReadinessAttempts = $attempt + 1
        try { $current = Get-DefenderStatus }
        catch {
            $report.defenderReadinessError = $_.Exception.Message
            if ($attempt -lt 29) { Start-Sleep -Seconds 2 }
            continue
        }
        $report.defenderAfterUpdate = $current | Select-Object AMRunningMode, AMProductVersion, AMEngineVersion, AMServiceEnabled, AntivirusEnabled, AntivirusSignatureVersion, AntivirusSignatureLastUpdated, AntivirusSignatureAge, DefenderSignaturesOutOfDate, InitializationProgress
        if ($current.AMServiceEnabled -and $current.AntivirusEnabled -and
            $current.AMEngineVersion -and $current.AMEngineVersion -ne '0.0.0.0' -and
            $current.AntivirusSignatureVersion -and $current.AntivirusSignatureLastUpdated -and
            $current.AntivirusSignatureLastUpdated -ge (Get-Date).AddDays(-3)) { return $current }
        if ($attempt -lt 29) { Start-Sleep -Seconds 2 }
    }
    throw 'Defender did not become ready with current signatures after update'
}
try {
    $build = Get-Content (Join-Path $ArtifactDirectory 'build-verification.json') -Raw | ConvertFrom-Json
    $installer = Get-Item (Join-Path $ArtifactDirectory $build.installer)
    $hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $build.sha256 -or $hash -ne $ExpectedSha256) { throw 'Installer identity mismatch' }
    $report.installer = @{name=$installer.Name;sha256=$hash;build=$build.build;commit=$build.commit;
        signatureStatus=[string](Get-AuthenticodeSignature $installer.FullName).Status}
    $status = Get-DefenderStatus
    $report.defender = @{antivirusEnabled=$status.AntivirusEnabled;engineVersion=$status.AMEngineVersion;
        signatureVersion=$status.AntivirusSignatureVersion;signatureUpdated=$status.AntivirusSignatureLastUpdated}
    if (-not $status.AntivirusEnabled) { throw 'Defender antivirus is not available on this runner' }
    $report.defenderBeforeUpdate = $status | Select-Object AMRunningMode, AMProductVersion, AMEngineVersion, AMServiceEnabled, AntivirusEnabled, AntivirusSignatureVersion, AntivirusSignatureLastUpdated, AntivirusSignatureAge, DefenderSignaturesOutOfDate, InitializationProgress
    $report.runner = @{os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); image=$env:ImageVersion}
    try { Update-MpSignature -ErrorAction Stop; $report.signatureUpdate='success' }
    catch {
        $report.signatureUpdate='failed; existing signature retained'
        # Preserve the real update error on the disposable runner, without changing
        # protection settings or treating failed updates as successful scans.
        $report.signatureUpdateError = @{message=$_.Exception.Message; type=$_.Exception.GetType().FullName;
            hresult=$_.Exception.HResult; errorId=$_.FullyQualifiedErrorId; category=[string]$_.CategoryInfo.Category;
            details=$_.ErrorDetails.Message}
        Write-Warning ("Defender signature update failed: " + $_.Exception.Message)
    }
    $status = Wait-DefenderStatus
    $report.defender.signatureVersion=$status.AntivirusSignatureVersion
    $report.defender.signatureUpdated=$status.AntivirusSignatureLastUpdated
    if (-not $status.AntivirusSignatureVersion -or -not $status.AntivirusSignatureLastUpdated) { throw 'Defender signature metadata is unavailable' }
    if ($status.AntivirusSignatureLastUpdated -lt (Get-Date).AddDays(-3)) { throw 'Defender signatures are stale' }
    $tools = @(Get-ChildItem "$env:ProgramData/Microsoft/Windows Defender/Platform/*/MpCmdRun.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
    $tool = if ($tools.Count) { $tools[0].FullName } else { "$env:ProgramFiles/Windows Defender/MpCmdRun.exe" }
    function Scan-Artifact([string]$Target, [string]$Name) {
        # Custom scan mode ignores exclusions and scans archives; it does not change
        # global protection. No remediation means evidence is retained without execution.
        & $tool -Scan -ScanType 3 -File $Target -DisableRemediation 2>&1 | Out-File (Join-Path $ReportDirectory "$Name.txt") -Encoding utf8
        return $LASTEXITCODE
    }
    $report.installerScanExit = Scan-Artifact $installer.FullName 'installer-scan'
    if ($report.installerScanExit -ne 0) { $report.verdict='detection_or_scan_error'; throw 'Installer scan needs investigation' }
    $payload = Join-Path $env:RUNNER_TEMP ("ripple-static-payload-" + [Guid]::NewGuid().ToString('N'))
    & 7z x -y "-o$payload" $installer.FullName | Out-File (Join-Path $ReportDirectory 'extraction.txt') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw 'Static archive extraction did not complete' }
    $files = @(Get-ChildItem $payload -Recurse -File)
    $report.extractedFileCount = $files.Count
    if ($files.Count -lt 10) { throw 'Static payload extraction is incomplete' }
    # Hash every payload file, including Python source and distribution metadata.
    # Compare text reports only; never execute a program from the inspected payload.
    $manifest = @($files | ForEach-Object {
        @{name=[IO.Path]::GetRelativePath($payload,$_.FullName);size=$_.Length;
          sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $ReportDirectory 'payload-inventory.json') -Encoding utf8
    $inventory = @($files | Where-Object {$_.Extension -in '.exe','.dll','.pyd'} | ForEach-Object {
        @{name=[IO.Path]::GetRelativePath($payload,$_.FullName);sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();
          signatureStatus=[string](Get-AuthenticodeSignature $_.FullName).Status}
    })
    $inventory | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $ReportDirectory 'binary-inventory.json') -Encoding utf8
    $report.payloadScanExit = Scan-Artifact $payload 'payload-scan'
    if ($report.payloadScanExit -ne 0) { $report.verdict='detection_or_scan_error'; throw 'Payload scan needs investigation' }
    $report.verdict='no_detection_in_this_defender_scan'
    $report.completed=$true
} catch {
    # Error messages are fixed by this script; raw process logs are separate CI evidence.
    $report.error=$_.Exception.Message
    throw
} finally {
    $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $ReportDirectory 'security-analysis.json') -Encoding utf8
}
