# Native backup/restore acceptance — 2026-08-29

Environment: Windows, portable PostgreSQL, local MinIO, PowerShell 7, MinIO Client.

1. `scripts/backup-native.ps1` produced a PostgreSQL custom dump, six MinIO report objects, and a SHA-256 manifest.
2. A new isolated database `threadbeacon_restore_acceptance_829` and Bucket `threadbeacon-restore-acceptance-829` were created.
3. `scripts/restore-native.ps1 -ConfirmRestore` verified checksums and restored both stores.
4. SQL verification returned 22 jobs; recursive object listing returned six report objects.
5. Only the isolated acceptance database and Bucket were removed after verification. The source database/Bucket were unchanged.

This proves the native logical backup and isolated restore path. It does not claim Docker volume, multi-replica, PITR, cross-architecture, HA, or rolling-upgrade acceptance.
