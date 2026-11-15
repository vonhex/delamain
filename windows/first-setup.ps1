# Download and set up everything Delamain needs (setup runs this after copying his files, and the
# shortcut runs it on first start if it was skipped). It is the zip's install.ps1, in a window
# that says what is happening and stays open if something goes wrong.
$Host.UI.RawUI.WindowTitle = 'Setting up Delamain'
$app = Split-Path -Parent $PSScriptRoot
Write-Host ''
Write-Host '  Setting up Delamain' -ForegroundColor Cyan
Write-Host '  This downloads Python, the right PyTorch for your graphics card and his voice tools.'
Write-Host '  It is several GB and can take 10 to 30 minutes. You can leave it running.'
Write-Host ''
try {
    & (Join-Path $app 'install.ps1') -NoStart
    Write-Host ''
    Write-Host '  Setup finished.' -ForegroundColor Green
    Start-Sleep 3
}
catch {
    Write-Host ''
    Write-Host "  Setup hit a problem: $_" -ForegroundColor Red
    Write-Host '  Check your internet connection and run "Delamain" from the Start Menu to try again;'
    Write-Host '  it picks up where it stopped. If it keeps failing, open an issue on GitHub with this text.'
    Write-Host ''
    Read-Host '  Press Enter to close'
    exit 1
}
