#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_dir="${1:-$root_dir/artifacts/release-drill}"
backup_dir="$evidence_dir/backup"
mc_bin="${MC_BIN:-mc}"
compose=(docker compose -f "$root_dir/compose.yaml" -f "$root_dir/infra/release-drill.compose.yaml")
db_user="${POSTGRES_USER:-threadbeacon}"
source_db="threadbeacon"
restore_db="threadbeacon_restore_drill"
source_bucket="${THREADBEACON_S3_BUCKET:-threadbeacon-reports}"
restore_bucket="threadbeacon-restore-drill"

case "$restore_db:$restore_bucket" in
  threadbeacon_restore_drill:threadbeacon-restore-drill) ;;
  *) echo "refusing non-isolated restore targets" >&2; exit 2 ;;
esac

rm -rf "$evidence_dir"
mkdir -p "$backup_dir/objects"

"${compose[@]}" exec -T postgres pg_dump -U "$db_user" -Fc -d "$source_db" > "$backup_dir/postgres.dump"
"$mc_bin" alias set release-drill http://127.0.0.1:9000 "${THREADBEACON_S3_ACCESS_KEY:-threadbeacon}" "${THREADBEACON_S3_SECRET_KEY:?missing THREADBEACON_S3_SECRET_KEY}" --api S3v4 >/dev/null
trap '"$mc_bin" alias remove release-drill >/dev/null 2>&1 || true' EXIT
"$mc_bin" mirror --overwrite "release-drill/$source_bucket" "$backup_dir/objects"
(cd "$backup_dir" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256 && sha256sum -c manifest.sha256)

"${compose[@]}" exec -T postgres dropdb --if-exists --force -U "$db_user" "$restore_db"
"${compose[@]}" exec -T postgres createdb -U "$db_user" "$restore_db"
"${compose[@]}" exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges -U "$db_user" -d "$restore_db" < "$backup_dir/postgres.dump"
"$mc_bin" mb --ignore-existing "release-drill/$restore_bucket" >/dev/null
"$mc_bin" mirror --overwrite --remove "$backup_dir/objects" "release-drill/$restore_bucket"

count_sql="select (select count(*) from projects)||':'||(select count(*) from project_sources)||':'||(select count(*) from workflows)||':'||(select count(*) from workflow_versions)||':'||(select count(*) from workflow_runs)||':'||(select count(*) from social_monitors);"
source_counts="$("${compose[@]}" exec -T postgres psql -At -U "$db_user" -d "$source_db" -c "$count_sql" | tr -d '\r')"
restore_counts="$("${compose[@]}" exec -T postgres psql -At -U "$db_user" -d "$restore_db" -c "$count_sql" | tr -d '\r')"
source_objects="$("$mc_bin" ls --recursive "release-drill/$source_bucket" | wc -l | tr -d ' ')"
restore_objects="$("$mc_bin" ls --recursive "release-drill/$restore_bucket" | wc -l | tr -d ' ')"

test "$source_counts" = "$restore_counts"
test "$source_objects" = "$restore_objects"
test "$source_objects" -gt 0

cat > "$evidence_dir/result.json" <<JSON
{
  "databaseCounts": "$source_counts",
  "objectCount": $source_objects,
  "restoreDatabase": "$restore_db",
  "restoreBucket": "$restore_bucket",
  "commit": "${GITHUB_SHA:-local}",
  "result": "passed"
}
JSON
cat "$evidence_dir/result.json"
