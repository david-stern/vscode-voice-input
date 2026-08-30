# Voice Input - Windows dependency installer
# Audio capture is self-contained; this only verifies optional paste helpers.
# Requires PowerShell 5+ (ships with Windows 10/11).
# NOTE: keep this file ASCII-only (no box-drawing, arrows, or em-dashes).
#       PowerShell 5.1 reads UTF-8 without BOM as ANSI and mis-decodes
#       those characters, which breaks string literals.

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   Voice Input - Windows dependency installer" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

function Test-Cmd($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

# -- Built-ins check ----------------------------------------------------------
Write-Host ""
Write-Host "Built-in tools (no install needed):"
foreach ($bin in @("powershell", "clip")) {
    if (Test-Cmd $bin) {
        Write-Host "  v  $bin" -ForegroundColor Green
    } else {
        Write-Host "  x  $bin  <- unexpected, should ship with Windows" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  All done!" -ForegroundColor Cyan
Write-Host "  Audio recording is bundled with the extension." -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
