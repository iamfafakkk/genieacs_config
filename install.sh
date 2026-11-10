#!/usr/bin/env bash
# Restore GenieACS MongoDB metadata dari ./db + UI custom dari ./ui.
# Koleksi devices tidak disentuh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="${SCRIPT_DIR}/db"
UI_DIR="${SCRIPT_DIR}/ui"
MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017}"
DB_NAME="${DB_NAME:-genieacs}"
GENIEACS_ROOT="${GENIEACS_ROOT:-/usr/local/lib/node_modules/genieacs}"

restore_ui() {
  local manifest="${UI_DIR}/manifest.json"
  if [[ ! -d "${UI_DIR}/public" ]]; then
    echo "Lewati restore UI: folder ${UI_DIR}/public tidak ada."
    return 0
  fi

  local bundle=""
  if [[ -f "${manifest}" ]]; then
    bundle=$(node -e "const m=require('${manifest}');process.stdout.write(m.bundle||'')" 2>/dev/null || true)
  fi
  if [[ -z "${bundle}" ]]; then
    bundle=$(find "${UI_DIR}/public" -maxdepth 1 -name 'app-*.js' ! -name '*.map' -printf '%P\n' -quit)
  else
    bundle="${bundle#public/}"
  fi

  if [[ -z "${bundle}" ]] || [[ ! -f "${UI_DIR}/public/${bundle}" ]]; then
    echo "Lewati restore UI: bundle tidak ditemukan di backup." >&2
    return 0
  fi

  local dest="${GENIEACS_ROOT}/public/${bundle}"
  if [[ ! -d "${GENIEACS_ROOT}/public" ]]; then
    echo "GenieACS tidak terpasang di ${GENIEACS_ROOT}" >&2
    return 1
  fi

  if [[ -f "${dest}" ]] && [[ ! -f "${dest}.pre-restore" ]]; then
    cp -a "${dest}" "${dest}.pre-restore"
  fi
  cp -a "${UI_DIR}/public/${bundle}" "${dest}"
  for suf in .orig .before-wlan-password-fix .before-unified-wan-fix; do
    [[ -f "${UI_DIR}/public/${bundle}${suf}" ]] && cp -a "${UI_DIR}/public/${bundle}${suf}" "${dest}${suf}"
  done

  if [[ -d "${UI_DIR}/scripts" ]]; then
    for f in tabs-patch.js fix-wan-table-config.js; do
      [[ -f "${UI_DIR}/scripts/${f}" ]] && cp -a "${UI_DIR}/scripts/${f}" "/root/${f}"
    done
  fi

  echo "UI bundle dipasang: ${dest}"
  if [[ -f /root/tabs-patch.js ]]; then
    echo "Patch script tersedia: /root/tabs-patch.js (jalankan setelah npm upgrade genieacs)"
  fi
}

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore not found. Install MongoDB Database Tools." >&2
  exit 1
fi

if [[ ! -d "${DB_DIR}" ]] || [[ -z "$(find "${DB_DIR}" -maxdepth 1 -name '*.bson' -print -quit 2>/dev/null)" ]]; then
  echo "Backup DB tidak ditemukan: ${DB_DIR}" >&2
  exit 1
fi

if [[ "${GENIEACS_RESTORE_YES:-}" != "1" ]]; then
  echo "Restore database '${DB_NAME}' dari ${DB_DIR}"
  find "${DB_DIR}" -maxdepth 1 -name '*.bson' -printf '  %f\n' | sed 's/\.bson$//'
  echo "  (tanpa devices)"
  if [[ -d "${UI_DIR}/public" ]]; then
    echo "Restore UI custom dari ${UI_DIR} ke ${GENIEACS_ROOT}/public"
  fi
  echo -n "Continue? [y/N] "
  read -r ans
  case "${ans}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

echo "Restoring MongoDB ..."
mongorestore \
  --uri="${MONGODB_URI}" \
  --drop \
  --db="${DB_NAME}" \
  --excludeCollection=devices \
  --dir="${DB_DIR}"

echo "Restore DB selesai."
restore_ui

if command -v systemctl >/dev/null 2>&1; then
  for svc in genieacs-ui genieacs-cwmp genieacs-nbi genieacs-fs; do
    if systemctl is-enabled "${svc}" >/dev/null 2>&1 || systemctl is-active "${svc}" >/dev/null 2>&1; then
      echo "Restarting ${svc} ..."
      systemctl restart "${svc}" || true
    fi
  done
fi

echo "Selesai. Hard refresh browser (Ctrl+Shift+R) setelah restore UI."
