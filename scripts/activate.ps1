# Dot-source this file from the repository root:
# . .\scripts\activate.ps1

$WorkspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$NodeHome = Join-Path $WorkspaceRoot '.tools\node-v24.18.0-win-x64'
$NodeExecutable = Join-Path $NodeHome 'node.exe'
$NpmExecutable = Join-Path $NodeHome 'npm.cmd'

if (-not (Test-Path -LiteralPath $NodeExecutable) -or -not (Test-Path -LiteralPath $NpmExecutable)) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -eq $NodeCommand -or $null -eq $NpmCommand) {
        throw 'Node.js 24 LTS and npm are not installed or could not be located.'
    }
    $NodeExecutable = $NodeCommand.Source
    $NpmExecutable = $NpmCommand.Source
    $NodePath = Split-Path -Parent $NodeExecutable
} else {
    $NodePath = $NodeHome
}

$GitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $GitCommand) {
    $GitExecutable = @(
        'C:\Program Files\Git\cmd\git.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $GitExecutable) {
        throw 'Git is not installed or could not be located.'
    }
} else {
    $GitExecutable = $GitCommand.Source
}

$UvCommand = Get-Command uv -ErrorAction SilentlyContinue
if ($null -eq $UvCommand) {
    throw 'uv is not installed or is not available on PATH.'
}

$PathEntries = @()
foreach ($entry in @($NodePath,(Split-Path -Parent $GitExecutable))) {
    if ($env:Path -notlike "*$entry*") {
        $PathEntries += $entry
    }
}
if ($PathEntries.Count -gt 0) {
    $env:Path = (($PathEntries + $env:Path) -join ';')
}
$env:UV_CACHE_DIR = Join-Path $WorkspaceRoot '.cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $WorkspaceRoot '.tools\python'
$env:npm_config_cache = Join-Path $WorkspaceRoot '.cache\npm'

Write-Host "Mutual Visibility workspace activated."
Write-Host "Node: $(& $NodeExecutable --version)"
Write-Host "npm:  $(& $NpmExecutable --version)"
Write-Host "Git:  $(& $GitExecutable --version)"
Write-Host "uv:   $(& $UvCommand.Source --version)"
