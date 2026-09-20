#!/usr/bin/env bash
set -euo pipefail

REPO='Aiowuka/longmao'
DEFAULT_REF='2ed5d554ed017cd97a68b786439c167920505684'
REF="${LONGMAO_REF:-$DEFAULT_REF}"
ARCHIVE_URL="https://github.com/$REPO/archive/$REF.tar.gz"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) ;;
  *) die 'The curl installer currently supports Linux only. Use the Windows EXE installer on Windows.' ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) die "Longmao Linux currently supports x86_64 only. Detected: $(uname -m)" ;;
esac

command -v curl >/dev/null 2>&1 || die 'curl is required.'
command -v tar >/dev/null 2>&1 || die 'tar is required.'

umask 077
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

archive="$tmp/longmao.tar.gz"
source_dir="$tmp/source"
mkdir -p "$source_dir"

say "Downloading Longmao source snapshot $REF"
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --silent --show-error \
  "$ARCHIVE_URL" -o "$archive"

tar -xzf "$archive" --strip-components=1 -C "$source_dir"
installer="$source_dir/scripts/linux/install.sh"
[[ -f "$installer" ]] || die 'Downloaded snapshot does not contain the Linux installer.'
chmod +x "$source_dir/scripts/linux/"*.sh

if [[ "${LONGMAO_BOOTSTRAP_TEST_ONLY:-0}" == '1' ]]; then
  printf 'Longmao bootstrap OK\nref=%s\ninstaller=%s\n' "$REF" "$installer"
  exit 0
fi

say 'Starting Longmao installer'
if [[ -r /dev/tty ]]; then
  exec "$installer" </dev/tty
fi

exec "$installer"
