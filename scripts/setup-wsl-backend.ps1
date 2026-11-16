$ErrorActionPreference = 'Stop'

$WorkspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$WorkspaceDrive = [char]::ToLowerInvariant($WorkspaceRoot[0])
$WorkspaceSuffix = $WorkspaceRoot.Substring(2).Replace('\', '/')
$WslWorkspaceRoot = "/mnt/$WorkspaceDrive$WorkspaceSuffix"

& wsl.exe -d Ubuntu -- true
if ($LASTEXITCODE -ne 0) {
    throw 'Ubuntu WSL is not available.'
}

$UvVersion = '0.11.32'
$UvInstallerSha256 = '43aff33a967fe40e8c17949d8c85c65bc43f3b5c94742393c957f56ab5ba80f4'
$UvExecutable = Join-Path $WorkspaceRoot '.tools\wsl\bin\uv'
$InstallerPath = Join-Path $WorkspaceRoot '.cache\uv-install-wsl.sh'

if (-not (Test-Path -LiteralPath $UvExecutable)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $InstallerPath) -Force | Out-Null
    Invoke-WebRequest -Uri "https://astral.sh/uv/$UvVersion/install.sh" -OutFile $InstallerPath -UseBasicParsing

    $InstallerHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($InstallerHash -ne $UvInstallerSha256) {
        throw "The uv installer checksum did not match the expected value: $InstallerHash"
    }

    & wsl.exe -d Ubuntu -- env "UV_UNMANAGED_INSTALL=$WslWorkspaceRoot/.tools/wsl/bin" `
        sh "$WslWorkspaceRoot/.cache/uv-install-wsl.sh"
    if ($LASTEXITCODE -ne 0) {
        throw "uv installation in WSL failed with exit code $LASTEXITCODE."
    }
}

& wsl.exe -d Ubuntu -- env `
    "UV_CACHE_DIR=$WslWorkspaceRoot/.cache/uv-wsl" `
    "UV_PYTHON_INSTALL_DIR=$WslWorkspaceRoot/.tools/python-wsl" `
    "UV_PROJECT_ENVIRONMENT=$WslWorkspaceRoot/.tools/wsl/venv/backend" `
    "$WslWorkspaceRoot/.tools/wsl/bin/uv" sync --project "$WslWorkspaceRoot/backend" --locked
if ($LASTEXITCODE -ne 0) {
    throw "Backend dependency synchronization in WSL failed with exit code $LASTEXITCODE."
}

Write-Host 'WSL backend environment is ready.'
