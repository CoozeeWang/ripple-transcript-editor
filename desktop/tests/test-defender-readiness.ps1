$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$source = Join-Path $PSScriptRoot '../scan-windows-artifact.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source).Path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
# Load only the pure readiness loop. Never run the scanner or actual updater.
$function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-DefenderStatus'}, $true)
Invoke-Expression $function.Extent.Text
function Start-Sleep { param($Seconds) $script:sleeps++ }
function Get-DefenderStatus {
    $script:calls++
    $index = [Math]::Min($script:calls - 1, $script:states.Count - 1)
    $state = $script:states[$index]
    if ($state -is [string]) { throw $state }
    return $state
}
function Run-Case($states, $expectedCalls, $expectedSuccess) {
    $script:states = $states; $script:calls = 0; $script:sleeps = 0; $script:report = @{}
    $success = $false
    try { $null = Wait-DefenderStatus; $success = $true } catch {
        if ($_.Exception.Message -ne 'Defender did not become ready with current signatures after update') { throw }
    }
    if ($success -ne $expectedSuccess -or $script:calls -ne $expectedCalls -or $script:sleeps -gt 29) { throw 'Readiness contract failed' }
}
$ready = @{AMServiceEnabled=$true; AntivirusEnabled=$true; AMEngineVersion='1.1.1.1'; AntivirusSignatureVersion='1.2.3.4'; AntivirusSignatureLastUpdated=(Get-Date)}
$restarting = @{AMServiceEnabled=$false; AntivirusEnabled=$false; AMEngineVersion='0.0.0.0'}
Run-Case @($ready) 1 $true
Run-Case @($restarting, $ready) 2 $true
Run-Case @('synthetic RPC failure', $ready) 2 $true
Run-Case @($restarting) 30 $false
$stale = $ready.Clone(); $stale.AntivirusSignatureLastUpdated = (Get-Date).AddDays(-4)
Run-Case @($stale) 30 $false
$disabled = $ready.Clone(); $disabled.AntivirusEnabled = $false
Run-Case @($disabled) 30 $false
$missing = $ready.Clone(); $missing.AntivirusSignatureVersion = $null
Run-Case @($missing) 30 $false
Write-Output 'Seven Defender readiness cases passed; no system protection settings changed.'
