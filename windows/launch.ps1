# Start Delamain and open him in the browser. The Start Menu and desktop shortcuts run this.
#
# If he is already running, it just opens the page. If setup never finished (it was skipped
# or interrupted), it finishes it first. The window stays open while he runs: close it to stop him.
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app

# Same port as start.bat: PORT from the environment or .env, else 8888
$port = $env:PORT
if (-not $port -and (Test-Path '.env')) {
    $line = Get-Content '.env' | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+' } | Select-Object -Last 1
    if ($line) { $port = ($line -split '=', 2)[1].Trim() }
}
if (-not $port) { $port = 8888 }
$url = "http://localhost:$port"

function Test-Up {
    try { return (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}

if (Test-Up) { Start-Process $url; exit 0 }

if (-not (Test-Path 'venv\Scripts\uvicorn.exe')) {
    & (Join-Path $PSScriptRoot 'first-setup.ps1')
    if (-not (Test-Path 'venv\Scripts\uvicorn.exe')) { exit 1 }
}

$Host.UI.RawUI.WindowTitle = 'Delamain - close this window to stop him'
Write-Host ''
Write-Host '  DELAMAIN' -ForegroundColor Cyan
Write-Host "  Starting on $url ... your browser opens when he is ready."
Write-Host '  From your phone, use this PC''s network address instead of localhost.'
Write-Host '  Keep this window open while you use him; close it to stop him.'
Write-Host ''

# Open the page as soon as he answers (the first start downloads his voice model, so it can take a while)
Start-Job -ArgumentList $url {
    param($u)
    for ($i = 0; $i -lt 600; $i++) {
        try {
            if ((Invoke-WebRequest "$u/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $u; return }
        } catch { }
        Start-Sleep 1
    }
} | Out-Null

& cmd.exe /c "`"$app\start.bat`""
