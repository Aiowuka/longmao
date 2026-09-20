#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.5.0}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/installer/linux/output"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

command -v makeself >/dev/null 2>&1 || {
  echo 'makeself is required to build the Linux .run installer.' >&2
  exit 1
}

mkdir -p "$OUT" "$STAGE/longmao"
(
  cd "$ROOT"
  tar     --exclude='.git'     --exclude='artifacts'     --exclude='installer/windows/output'     --exclude='installer/linux/output'     --exclude='config/totoro.json'     -cf - .
) | tar -xf - -C "$STAGE/longmao"

chmod +x "$STAGE/longmao"/scripts/linux/*.sh
rm -f "$OUT/LongmaoSetup-$VERSION-linux-x64.run"

makeself   --quiet   --nox11   "$STAGE/longmao"   "$OUT/LongmaoSetup-$VERSION-linux-x64.run"   "Longmao $VERSION Linux x64"   ./scripts/linux/install.sh

sha256sum "$OUT/LongmaoSetup-$VERSION-linux-x64.run"   | tee "$OUT/LongmaoSetup-$VERSION-linux-x64.run.sha256"

echo "Built: $OUT/LongmaoSetup-$VERSION-linux-x64.run"
