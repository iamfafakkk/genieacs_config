# genieacs_config

Backup & restore GenieACS **tanpa** koleksi `devices`.

- `backup.sh` — dump MongoDB + salin UI bundle / patch scripts
- `install.sh` — restore DB + pasang UI, restart service
- `db/` — BSON (`config`, `provisions`, `presets`, …)
- `ui/` — frontend custom + `tabs-patch.js`

`ui/genieacs.env` tidak di-git (rahasia JWT); pakai `ui/genieacs.env.example` sebagai acuan.
