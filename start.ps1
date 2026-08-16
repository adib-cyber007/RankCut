$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalNode = Join-Path $AppRoot 'tools\node.exe'
$ServerScript = Join-Path $AppRoot 'server.js'
$HealthUrl = 'http://127.0.0.1:4174/api/health'
$AppUrl = 'http://127.0.0.1:4174/'

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'tools\ffmpeg.exe')) -or
    -not (Test-Path -LiteralPath (Join-Path $AppRoot 'tools\ffprobe.exe')) -or
    -not (Test-Path -LiteralPath (Join-Path $AppRoot 'tools\yt-dlp.exe'))) {
  Write-Host 'Media tools are not installed. Running one-time setup...' -ForegroundColor Yellow
  & (Join-Path $AppRoot 'setup.ps1')
}

$NodeCommand = $null
if (Test-Path -LiteralPath $LocalNode) {
  $NodeCommand = $LocalNode
} else {
  $SystemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($SystemNode) { $NodeCommand = $SystemNode.Source }
}

if (-not $NodeCommand) {
  Write-Host 'Node.js is not available. Running one-time setup...' -ForegroundColor Yellow
  & (Join-Path $AppRoot 'setup.ps1')
  if (Test-Path -LiteralPath $LocalNode) { $NodeCommand = $LocalNode }
}

if (-not $NodeCommand) { throw 'Node.js could not be installed. Install Node.js 18+ and try again.' }

$AlreadyRunning = $false
try {
  $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  if ($Health.ok) { $AlreadyRunning = $true }
} catch {}

if (-not $AlreadyRunning) {
  $Process = Start-Process -FilePath $NodeCommand -ArgumentList @("`"$ServerScript`"") -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
      if ($Health.ok) { $Ready = $true; break }
    } catch {}
  }
  if (-not $Ready) {
    if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force }
    throw 'RankCut Studio could not start its local server.'
  }
}

Start-Process $AppUrl
Write-Host 'RankCut Studio is open in your browser.' -ForegroundColor Green
