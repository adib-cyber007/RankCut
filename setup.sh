#!/bin/bash
set -euo pipefail

APP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TOOLS_DIR="$APP_ROOT/tools"
NODE_VERSION="${RANKCUT_NODE_VERSION:-22.23.2}"

for argument in "$@"; do
  case "$argument" in
    -h|--help)
      printf 'Usage: ./setup.sh\n'
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$argument" >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This setup script is for macOS. On Windows, run setup.ps1 instead.\n' >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH='arm64' ;;
  x86_64) NODE_ARCH='x64' ;;
  *)
    printf 'Unsupported Mac architecture: %s\n' "$ARCH" >&2
    exit 1
    ;;
esac

mkdir -p "$TOOLS_DIR"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rankcut-setup.XXXXXX")"
cleanup() { rm -rf -- "$TEMP_DIR"; }
trap cleanup EXIT

download() {
  local url="$1"
  local destination="$2"
  printf '  Downloading %s...\n' "$(basename "$destination")"
  curl --location --fail --retry 3 --connect-timeout 20 --output "$destination" "$url"
}

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return
  fi
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

link_tool() {
  local command_name="$1"
  local destination_name="$2"
  local source_path
  source_path="$(command -v "$command_name")"
  ln -sfn "$source_path" "$TOOLS_DIR/$destination_name"
}

printf '\n  RankCut Studio setup for macOS (%s)\n' "$ARCH"
printf '  -----------------------------------------\n'

NODE_COMMAND=''
if [[ -x "$TOOLS_DIR/node" ]]; then
  NODE_COMMAND="$TOOLS_DIR/node"
elif command -v node >/dev/null 2>&1; then
  SYSTEM_NODE="$(command -v node)"
  NODE_MAJOR="$("$SYSTEM_NODE" -p "Number(process.versions.node.split('.')[0])")"
  if [[ "$NODE_MAJOR" -ge 18 ]]; then NODE_COMMAND="$SYSTEM_NODE"; fi
fi

if [[ -z "$NODE_COMMAND" ]]; then
  NODE_ARCHIVE="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
  download "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" "$TEMP_DIR/$NODE_ARCHIVE"
  tar -xzf "$TEMP_DIR/$NODE_ARCHIVE" -C "$TEMP_DIR"
  cp "$TEMP_DIR/node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node" "$TOOLS_DIR/node"
  chmod +x "$TOOLS_DIR/node"
  NODE_COMMAND="$TOOLS_DIR/node"
else
  printf '  Node.js %s is available.\n' "$("$NODE_COMMAND" --version)"
fi

if [[ ! -x "$TOOLS_DIR/yt-dlp" ]]; then
  download 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos' "$TEMP_DIR/yt-dlp"
  mv "$TEMP_DIR/yt-dlp" "$TOOLS_DIR/yt-dlp"
  chmod +x "$TOOLS_DIR/yt-dlp"
else
  printf '  yt-dlp is already installed.\n'
fi

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  link_tool ffmpeg ffmpeg
  link_tool ffprobe ffprobe
else
  BREW="$(find_brew || true)"
  if [[ -z "$BREW" ]]; then
    printf '\nFFmpeg is required. Install Homebrew from https://brew.sh, then rerun ./setup.sh.\n' >&2
    exit 1
  fi
  eval "$("$BREW" shellenv)"
  printf '  Installing FFmpeg with Homebrew...\n'
  "$BREW" install ffmpeg
  link_tool ffmpeg ffmpeg
  link_tool ffprobe ffprobe
fi

"$NODE_COMMAND" --version >/dev/null
"$TOOLS_DIR/yt-dlp" --version >/dev/null
"$TOOLS_DIR/ffmpeg" -version >/dev/null 2>&1
"$TOOLS_DIR/ffprobe" -version >/dev/null 2>&1

printf '\n  Setup complete. Double-click Start RankCut.command to open the editor.\n\n'
