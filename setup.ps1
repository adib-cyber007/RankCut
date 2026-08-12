param(
  [switch]$SkipNode
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsDir = Join-Path $AppRoot 'tools'
$TempDir = Join-Path $AppRoot 'data\setup-temp'

New-Item -ItemType Directory -Force -Path $ToolsDir, $TempDir | Out-Null

function Get-RemoteFile {
  param([string]$Uri, [string]$Destination)
  Write-Host "  Downloading $([IO.Path]::GetFileName($Destination))..." -ForegroundColor Cyan
  $Node = Get-Command node -ErrorAction SilentlyContinue
  if ($Node) {
    $DownloadScript = "fetch(process.argv[1]).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);const fs=require('fs');const {Readable}=require('stream');await require('stream/promises').pipeline(Readable.fromWeb(r.body),fs.createWriteStream(process.argv[2]));}).catch(e=>{console.error(e);process.exit(1)})"
    & $Node.Source -e $DownloadScript $Uri $Destination
    if ($LASTEXITCODE -eq 0) { return }
  }
  $Curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($Curl) {
    & $Curl.Source -L --fail --retry 3 --ssl-no-revoke --connect-timeout 20 --output $Destination $Uri
    if ($LASTEXITCODE -ne 0) { throw "Download failed with exit code $LASTEXITCODE." }
  } else {
    Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
  }
}

Write-Host ""
Write-Host "  RankCut Studio setup" -ForegroundColor Magenta
Write-Host "  --------------------"

$YtDlpPath = Join-Path $ToolsDir 'yt-dlp.exe'
if (-not (Test-Path -LiteralPath $YtDlpPath)) {
  Get-RemoteFile -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -Destination $YtDlpPath
} else {
  Write-Host "  Updating yt-dlp extractors..." -ForegroundColor DarkGray
  & $YtDlpPath -U
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Automatic update was unavailable; keeping the installed yt-dlp." -ForegroundColor Yellow
  }
}

$FfmpegPath = Join-Path $ToolsDir 'ffmpeg.exe'
$FfprobePath = Join-Path $ToolsDir 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $FfmpegPath) -or -not (Test-Path -LiteralPath $FfprobePath)) {
  $FfmpegZip = Join-Path $TempDir 'ffmpeg.zip'
  $FfmpegExtract = Join-Path $TempDir 'ffmpeg'
  Get-RemoteFile -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -Destination $FfmpegZip
  if (Test-Path -LiteralPath $FfmpegExtract) { Remove-Item -LiteralPath $FfmpegExtract -Recurse -Force }
  Expand-Archive -LiteralPath $FfmpegZip -DestinationPath $FfmpegExtract -Force
  $BinDir = Get-ChildItem -LiteralPath $FfmpegExtract -Directory | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'bin' }
  if (-not $BinDir -or -not (Test-Path -LiteralPath (Join-Path $BinDir 'ffmpeg.exe'))) {
    throw 'FFmpeg download did not contain the expected binaries.'
  }
  Copy-Item -LiteralPath (Join-Path $BinDir 'ffmpeg.exe') -Destination $FfmpegPath -Force
  Copy-Item -LiteralPath (Join-Path $BinDir 'ffprobe.exe') -Destination $FfprobePath -Force
} else {
  Write-Host "  FFmpeg already installed." -ForegroundColor DarkGray
}

if (-not $SkipNode) {
  $LocalNode = Join-Path $ToolsDir 'node.exe'
  $SystemNode = Get-Command node -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $LocalNode) -and -not $SystemNode) {
    $NodeZip = Join-Path $TempDir 'node.zip'
    $NodeExtract = Join-Path $TempDir 'node'
    Get-RemoteFile -Uri 'https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip' -Destination $NodeZip
    if (Test-Path -LiteralPath $NodeExtract) { Remove-Item -LiteralPath $NodeExtract -Recurse -Force }
    Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeExtract -Force
    $NodeExe = Get-ChildItem -LiteralPath $NodeExtract -Filter node.exe -Recurse | Select-Object -First 1
    if (-not $NodeExe) { throw 'Node.js download did not contain node.exe.' }
    Copy-Item -LiteralPath $NodeExe.FullName -Destination $LocalNode -Force
  } elseif ($SystemNode) {
    Write-Host "  Node.js is available on this PC." -ForegroundColor DarkGray
  } else {
    Write-Host "  Portable Node.js already installed." -ForegroundColor DarkGray
  }
}

try {
  & $YtDlpPath --version | Out-Null
  & $FfmpegPath -version 2>$null | Select-Object -First 1 | Out-Null
  & $FfprobePath -version 2>$null | Select-Object -First 1 | Out-Null
} catch {
  throw "A media tool could not start: $($_.Exception.Message)"
}

if (Test-Path -LiteralPath $TempDir) { Remove-Item -LiteralPath $TempDir -Recurse -Force }

Write-Host ""
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host "  Double-click Start RankCut.bat to open the editor." -ForegroundColor White
Write-Host ""
