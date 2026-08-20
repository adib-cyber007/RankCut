#!/bin/bash
set -euo pipefail

APP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TOOLS_DIR="$APP_ROOT/tools"
PORT="${RANKCUT_PORT:-4174}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
APP_URL="http://127.0.0.1:${PORT}/"
LOG_FILE="$APP_ROOT/data/rankcut-server.log"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This launcher is for macOS. On Windows, use Start RankCut.bat.\n' >&2
  exit 1
fi

NODE_COMMAND=''
if [[ -x "$TOOLS_DIR/node" ]]; then
  NODE_COMMAND="$TOOLS_DIR/node"
elif command -v node >/dev/null 2>&1; then
  NODE_COMMAND="$(command -v node)"
fi

if [[ -z "$NODE_COMMAND" || ! -x "$TOOLS_DIR/ffmpeg" || ! -x "$TOOLS_DIR/ffprobe" || ! -x "$TOOLS_DIR/yt-dlp" ]]; then
  printf 'Media tools are not ready. Running one-time setup...\n'
  "$APP_ROOT/setup.sh"
  if [[ -x "$TOOLS_DIR/node" ]]; then NODE_COMMAND="$TOOLS_DIR/node"; fi
  if [[ -z "$NODE_COMMAND" ]] && command -v node >/dev/null 2>&1; then NODE_COMMAND="$(command -v node)"; fi
fi

if [[ -z "$NODE_COMMAND" ]]; then
  printf 'Node.js could not be prepared. Install Node.js 18+ and try again.\n' >&2
  exit 1
fi

if curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  open "$APP_URL"
  printf 'RankCut Studio is already running and is open in your browser.\n'
  exit 0
fi

mkdir -p "$APP_ROOT/data"
: > "$LOG_FILE"
nohup "$NODE_COMMAND" "$APP_ROOT/server.js" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!

READY=false
for _attempt in $(seq 1 40); do
  sleep 0.25
  if curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    READY=true
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then break; fi
done

if [[ "$READY" != true ]]; then
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  printf 'RankCut Studio could not start. Recent log output:\n' >&2
  tail -n 20 "$LOG_FILE" >&2 || true
  exit 1
fi

open "$APP_URL"
printf 'RankCut Studio is open in your browser. Server PID: %s\n' "$SERVER_PID"
