# One-step installer for Delamain on Windows. Run install.bat (double-click), or:
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-NoStart]
#
# Installs uv (which brings its own Python), PyTorch for this PC (NVIDIA GPU or CPU),
# Delamain's Python packages and a private copy of Node.js, all inside this folder, and
# builds the web UI. The voice model and lip-synced clips download on the first start.
# Safe to run again to update. Override the PyTorch build with $env:TORCH_INDEX.
param([switch]$NoStart)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Say($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Run($exe) {
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "$exe $args failed (exit $LASTEXITCODE)" }
}

# uv and Python
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Say 'Installing uv (Python package manager)'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
$py = 'venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Say 'Creating the Python environment'
    Run uv venv --python 3.12 venv
}

# PyTorch for this PC
$index = $env:TORCH_INDEX
if (-not $index) {
    $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    $index = if ($nvidia) { 'https://download.pytorch.org/whl/cu126' } else { 'https://download.pytorch.org/whl/cpu' }
}
$haveTorch = $false
try { & $py -c 'import torch, torchaudio' 2>$null; $haveTorch = ($LASTEXITCODE -eq 0) } catch { }
if (-not $haveTorch) {
    Say "Installing PyTorch ($index)"
    Run uv pip install --python $py torch torchaudio --index-url $index
}

Say "Installing Delamain's Python packages"
Run uv pip install --python $py -r requirements.txt

# Node.js and the web UI
function NodeOk($node) {
    # No double quotes in the script: Windows PowerShell drops them when calling programs.
    try { & $node -e 'process.exit(parseInt(process.versions.node) < 20 ? 1 : 0)' 2>$null; return $LASTEXITCODE -eq 0 }
    catch { return $false }
}
if (-not (NodeOk 'node')) {
    if (-not (NodeOk 'venv\Scripts\node.exe')) {
        Say 'Installing a private copy of Node.js (only inside this folder)'
        Run uv pip install --python $py nodeenv
        $env:VIRTUAL_ENV = "$PSScriptRoot\venv"
        Run venv\Scripts\nodeenv.exe --python-virtualenv --node=lts --prebuilt
    }
    $env:Path = "$PSScriptRoot\venv\Scripts;$env:Path"
}

Say 'Building the web UI'
Push-Location frontend
try {
    Run npm ci --no-audit --no-fund --loglevel=error
    Run npm run build
} finally { Pop-Location }

Say 'Done'
Write-Host @'
Open http://localhost:8888 (or http://<this PC's address>:8888 from your phone),
choose a password, and point Settings -> Integrations at your LLM.
The first start downloads the voice model (about 1.3 GB) and the lip-synced clips
(about 240 MB), then records Delamain's fixed lines in the background.
Start it again later with start.bat
'@

if (-not $NoStart) {
    Start-Job { Start-Sleep 5; Start-Process 'http://localhost:8888' } | Out-Null
    & .\start.bat
}
