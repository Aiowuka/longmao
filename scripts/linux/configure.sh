#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

backend_origin="${1:-}"
if [[ -z "$backend_origin" ]]; then
  printf '\nLongmao 首次配置\n'
  printf '请输入你的 Totoro-compatible 后台 HTTPS origin。\n'
  printf '示例: https://api.example.com\n'
  read -r -p 'Backend origin: ' backend_origin
fi

backend_origin="$(normalize_https_origin "$backend_origin")"

mkdir -p "$LONGMAO_CONFIG_ROOT_RESOLVED"
cat >"$LONGMAO_CONFIG_FILE" <<JSON
{
  "schemaVersion": 1,
  "baseUrl": "http://127.0.0.1:3000",
  "capture": {
    "origin": "$backend_origin",
    "pathPrefixes": ["/wxxcx/"],
    "requestHeaderNames": ["authorization"],
    "responseJsonPaths": ["token", "data.token"]
  }
}
JSON
chmod 600 "$LONGMAO_CONFIG_FILE"

if [[ -d "$LONGMAO_TOTORO" ]]; then
  cat >"$LONGMAO_TOTORO/.env.local" <<ENV
SUNRUN_MINIPROGRAM_BASE_URL=$backend_origin
SUNRUN_MINIPROGRAM_FALLBACK_BASE_URL=$backend_origin
REDIS_URL=redis://127.0.0.1:6379
ENV
  chmod 600 "$LONGMAO_TOTORO/.env.local"
fi

printf '\n配置完成。\n后台: %s\nLongmao 配置: %s\n' "$backend_origin" "$LONGMAO_CONFIG_FILE"
