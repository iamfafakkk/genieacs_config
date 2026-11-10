GenieACS backup (tanpa devices) — 2026-11-10T08:28:04+00:00

Restore:
  mongorestore --uri='mongodb://127.0.0.1:27017' --drop \
    --nsInclude='genieacs.*' --excludeCollection=genieacs.devices \
    --dir /root/genieacs_config/db
