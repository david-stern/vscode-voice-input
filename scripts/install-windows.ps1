# Voice Input — Windows dependency installer
# Run once after installing the extension to get ffmpeg.
# Requires PowerShell 5+ (ships with Windows 10/11).

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Voice Input — Windows dependency installer     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

function Test-Cmd($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

# ── ffmpeg ───────────────────────────────────────────────────────────────────
if (Test-Cmd "ffmpeg") {
    $ver = (ffmpeg -version 2>&1 | Select-Object -First 1)
    Write-Host "  v  ffmpeg already installed ($ver)." -ForegroundColor Green
} else {
    Write-Host "->  Installing ffmpeg via winget..." -ForegroundColor Yellow

    # Check winget is available (Windows 10 1709+ / Windows 11)
    if (-not (Test-Cmd "winget")) {
        Write-Host ""
        Write-Host "  x  winget not found." -ForegroundColor Red
        Write-Host "     Install ffmpeg manually from: https://ffmpeg.org/download.html" -ForegroundColor Yellow
        Write-Host "     Or install the 'App Installer' package from the Microsoft Store." -ForegroundColor Yellow
        exit 1
    }

    winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements

    # Refresh PATH in current session so we can verify immediately
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")

    if (Test-Cmd "ffmpeg") {
        Write-Host "  v  ffmpeg installed successfully." -ForegroundColor Green
    } else {
        Write-Host "  !  ffmpeg installed but not yet on PATH." -ForegroundColor Yellow
        Write-Host "     Restart your terminal or VSCode for PATH to update." -ForegroundColor Yellow
    }
}

# ── Built-ins check ──────────────────────────────────────────────────────────
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
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  All done!                                                           ║" -ForegroundColor Cyan
Write-Host "║  If ffmpeg was just installed, restart VSCode so PATH is refreshed. ║" -ForegroundColor Cyan
Write-Host "║  Find your audio device name with:                                  ║" -ForegroundColor Cyan
Write-Host "║    ffmpeg -hide_banner -list_devices true -f dshow -i dummy         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
