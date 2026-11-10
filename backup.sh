#!/usr/bin/env bash
# Backup GenieACS metadata (MongoDB tanpa devices) + UI custom (bundle + patch scripts).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="${SCRIPT_DIR}/db"
UI_DIR="${SCRIPT_DIR}/ui"
MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/genieacs}"
GENIEACS_ROOT="${GENIEACS_ROOT:-/usr/local/lib/node_modules/genieacs}"

if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found." >&2
  exit 1
fi

mkdir -p "${DB_DIR}" "${UI_DIR}/public" "${UI_DIR}/scripts"

TMP=$(mktemp -d)
mongodump --quiet --uri="${MONGODB_URI}" --excludeCollection=devices --out="${TMP}"
mv "${TMP}/genieacs"/* "${DB_DIR}/"
rmdir "${TMP}/genieacs" "${TMP}"

APP="$(find "${GENIEACS_ROOT}/public" -maxdepth 1 -name 'app-*.js' ! -name '*.map' -print -quit)"
if [[ -z "${APP}" ]] || [[ ! -f "${APP}" ]]; then
  echo "GenieACS UI bundle not found under ${GENIEACS_ROOT}/public" >&2
  exit 1
fi

cp -a "${APP}" "${UI_DIR}/public/$(basename "${APP}")"
for suf in .orig .before-wlan-password-fix .before-unified-wan-fix; do
  [[ -f "${APP}${suf}" ]] && cp -a "${APP}${suf}" "${UI_DIR}/public/$(basename "${APP}")${suf}" || true
done

for f in tabs-patch.js fix-wan-table-config.js; do
  [[ -f "/root/${f}" ]] && cp -a "/root/${f}" "${UI_DIR}/scripts/${f}"
done

[[ -f /opt/genieacs/genieacs.env ]] && cp -a /opt/genieacs/genieacs.env "${UI_DIR}/genieacs.env" || true

PKG_VER=""
[[ -f "${GENIEACS_ROOT}/package.json" ]] && PKG_VER=$(node -p "require('${GENIEACS_ROOT}/package.json').version" 2>/dev/null || true)

cat > "${UI_DIR}/manifest.json" <<EOF
{
  "backedUpAt": "$(date -Iseconds)",
  "genieacsVersion": "${PKG_VER}",
  "bundle": "public/$(basename "${APP}")",
  "notes": "config UI (ui.device.*) ada di db/config.bson; bundle + scripts untuk patch frontend"
}
EOF

echo "Backup selesai:"
echo "  DB:  ${DB_DIR}"
echo "  UI:  ${UI_DIR} ($(du -sh "${UI_DIR}" | cut -f1))"
find "${DB_DIR}" -maxdepth 1 -name '*.bson' | wc -l | xargs echo "  Koleksi:"
