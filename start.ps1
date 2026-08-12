param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalNode = Join-Path $AppRoot 'tools\node.exe'
$ServerScript = Join-Path $AppRoot 'server.js'
$HealthUrl = 'http://127.0.0.1:4174/api/health'
$AppUrl = 'http://127.0.0.1:4174/'
$ExpectedVersion = '2.1.1'

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
  if ($Health.ok -and $Health.version -eq $ExpectedVersion) {
    $AlreadyRunning = $true
  } elseif ($Health.ok -and $Health.pid) {
    Write-Host 'Replacing an older RankCut Studio server...' -ForegroundColor Yellow
    Stop-Process -Id ([int]$Health.pid) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
  } elseif ($Health.ok -and $Health.app -eq 'RankCut Studio') {
    Write-Host 'Replacing an older RankCut Studio server...' -ForegroundColor Yellow
    $Listener = Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $RankCutProcessId = if ($Listener) { [int]$Listener.OwningProcess } else { $null }
    if (-not $RankCutProcessId) {
      $NetstatLine = netstat -ano -p TCP | Select-String -Pattern '^\s*TCP\s+127\.0\.0\.1:4174\s+.*LISTENING\s+(\d+)\s*$' | Select-Object -First 1
      if ($NetstatLine -and $NetstatLine.Matches.Count) { $RankCutProcessId = [int]$NetstatLine.Matches[0].Groups[1].Value }
    }
    if ($RankCutProcessId) { Stop-Process -Id $RankCutProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 400
  }
} catch {}

if (-not $AlreadyRunning) {
  $Process = Start-Process -FilePath $NodeCommand -ArgumentList @("`"$ServerScript`"") -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
      if ($Health.ok -and $Health.version -eq $ExpectedVersion) { $Ready = $true; break }
    } catch {}
  }
  if (-not $Ready) {
    if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force }
    throw 'RankCut Studio could not start its local server.'
  }
}

if (-not $NoBrowser) {
  Start-Process $AppUrl
  Write-Host 'RankCut Studio is open in your browser.' -ForegroundColor Green
} else {
  Write-Host 'RankCut Studio server is ready.' -ForegroundColor Green
}
