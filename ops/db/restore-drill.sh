#!/usr/bin/env bash
# The server half of the restore drill (ADR-088). `pnpm backup:drill` copies
# it to the server and runs it; nobody needs to call it by hand.
#
#   restore-drill.sh <live container> <database owner> <database> <upload epoch> < backup.sql.gz
#
# Reads a Dokploy backup (`pg_dump -Fc | gzip`) on stdin, restores it into a
# throwaway Postgres made from the live container's own image, and compares
# the copy with the live database. <upload epoch> is when the backup reached
# S3, in seconds. Prints key=value lines on stdout for the laptop half to
# judge, ending with `done=ok`; progress goes to stderr.
#
# The backup holds every buyer's name, email and phone, so:
# - the dump is never written to a file: it streams into the throwaway, whose
#   data directory is a tmpfs that can't be swapped out, and whose logs go
#   nowhere (Postgres logs a failing row in full); the throwaway has no
#   network. (The stream's buffers in sshd, gunzip and docker are ordinary
#   host memory, which the host may swap.)
# - the throwaway is removed on every exit, a failed or interrupted run too;
# - the live database is read in read-only transactions, so Postgres itself
#   refuses a write from here, and nothing from the backup is ever pasted
#   into a live query;
# - the output is names, counts, timestamps and hashes, never a row.
#
# Anyone holding the Dokploy key can write a backup, and pg_restore runs its
# SQL as a superuser. So the throwaway can't write outside its tmpfs mounts,
# start more than a few processes, or outlive live Postgres when memory runs
# short; and every value printed here is one line, or the drill stops.
set -euo pipefail

live_name=${1:?live container name}
owner=${2:?database owner}
db=${3:?database}
upload=${4:?upload time in epoch seconds}
[[ $live_name =~ ^[a-z0-9][a-z0-9_.-]*$ && $owner =~ ^[a-z_][a-z0-9_]*$ &&
  $db =~ ^[a-z_][a-z0-9_]*$ && $upload =~ ^[0-9]+$ ]] || {
  printf 'bad arguments\n' >&2
  exit 2
}
here=$(cd "$(dirname "$0")" && pwd)
drill="echoandaura-restore-drill-$$"

# -v: in case the image declares a VOLUME the tmpfs mounts below miss.
trap 'docker rm -fv "$drill" >/dev/null 2>&1 || true' EXIT
# Without these, a dropped ssh session kills bash before the EXIT trap runs.
# ssh without a tty sends no HUP: a lost laptop shows up as EOF on stdin and
# SIGPIPE on the next line written to stdout.
trap 'exit 129' HUP INT TERM PIPE

say() { printf '%s\n' "$*" >&2; }
# A value with a newline in it (a table name in the backup can hold one)
# would print lines of its own, forging the report.
emit() {
  if [[ $2 == *$'\n'* ]]; then
    say "$1: the value is more than one line"
    exit 2
  fi
  printf '%s=%s\n' "$1" "$2"
}

# Container IDs whose whole name matches $1. Swarm names a service's
# container <service>.<slot>.<task id>; compose uses the name as given.
named() {
  docker ps "${@:2}" --format '{{.ID}} {{.Names}}' |
    while read -r id name; do
      if [[ $name =~ $1 ]]; then printf '%s\n' "$id"; fi
    done
}

# A drill killed outright (SIGKILL, a reboot mid-run) can't run its trap. Its
# throwaway is named after its script's pid: remove those whose script is
# gone, and leave a drill that is still running alone.
docker ps -a --format '{{.ID}} {{.Names}}' |
  while read -r id name; do
    if [[ $name =~ ^echoandaura-restore-drill-([0-9]+)$ ]] && ! ps -p "${BASH_REMATCH[1]}" >/dev/null; then
      say "removing a throwaway left by an earlier drill"
      docker rm -fv "$id" >/dev/null
    fi
  done

live_ids=$(named "^${live_name//./\\.}(\\.[0-9]+\\.[a-z0-9]+)?\$")
if [[ $(grep -c . <<<"$live_ids" || true) -ne 1 ]]; then
  say "expected one running container named $live_name, found: ${live_ids:-none}"
  exit 2
fi
live_id=$live_ids
# The image ID, not the tag: the same Postgres build as production, already
# on the server, so nothing is pulled.
image=$(docker inspect -f '{{.Image}}' "$live_id")
emit image "$image"

# The image declares its data directory a VOLUME. A tmpfs there keeps the
# data in memory, and stops Docker making a volume for it on the host's disk.
mounts=()
for volume in $(docker image inspect -f '{{range $k, $v := .Config.Volumes}}{{$k}} {{end}}' "$image"); do
  if [[ ! $volume =~ ^/[a-z0-9/_.-]+$ ]]; then
    say "unexpected VOLUME in the image: $volume"
    exit 2
  fi
  mounts+=(--tmpfs "$volume:rw,size=512m")
done

say "starting a throwaway Postgres"
# The root is read-only, so nothing lands in the container's layer on disk;
# the entrypoint's chown and gosu need the five capabilities kept.
docker run -d --name "$drill" --network none --log-driver none \
  --memory 768m --memory-swap 768m --cpus 1 --pids-limit 128 --oom-score-adj 1000 \
  --read-only ${mounts[@]+"${mounts[@]}"} \
  --tmpfs /var/run/postgresql:rw,size=1m --tmpfs /tmp:rw,size=16m \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --cap-add SETGID --cap-add SETUID --security-opt no-new-privileges \
  -e POSTGRES_USER="$owner" -e POSTGRES_DB="$db" -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$image" >/dev/null

in_drill() { docker exec -u postgres "$@"; }
# Over TCP on purpose: the image's first-start server listens on the socket
# only, and stops again before the real one starts.
ready() { in_drill "$drill" pg_isready -q -h 127.0.0.1 -U "$owner" -d "$db"; }
for _ in $(seq 60); do
  ready && break
  sleep 1
done
if ! ready; then
  say "the throwaway Postgres did not start"
  exit 2
fi
# Equal --memory and --memory-swap mean no swap, unless the host has no swap
# accounting, when Docker only warns. Ask the kernel what it was told.
swap=$(in_drill "$drill" cat /sys/fs/cgroup/memory.swap.max 2>/dev/null || true)
if [[ $swap != 0 ]]; then
  say "the throwaway could swap to disk (memory.swap.max: ${swap:-unreadable})"
  exit 2
fi

say "restoring the backup"
start=$(date +%s)
# --exit-on-error: the restore rebuilds every CHECK, UNIQUE and foreign key
# and checks each row against them, so one bad row fails the drill.
# timeout: a laptop that drops off without closing the connection would
# leave gunzip waiting on stdin, and the copy in memory, until it ends.
if err=$(timeout 600 gunzip -c | in_drill -i "$drill" pg_restore -U "$owner" -d "$db" \
  --no-owner --no-acl --exit-on-error 2>&1); then
  emit restore ok
  emit restore_seconds $(($(date +%s) - start))
else
  emit restore failed
  # The container's memory limit is the likeliest cause after a bad dump. If
  # Postgres itself was killed, the container is gone and only inspect knows.
  emit oom_kills "$(in_drill "$drill" cat /sys/fs/cgroup/memory.events 2>/dev/null |
    awk '$1 == "oom_kill" { print $2 }' || true)"
  emit oom_killed "$(docker inspect -f '{{.State.OOMKilled}}' "$drill" 2>/dev/null || true)"
  # A failed statement's DETAIL and CONTEXT lines can quote a whole row: keep
  # only the error lines, masked (mask-errors.awk).
  printf '%s\n' "$err" | grep '^pg_restore: error:' |
    awk -f "$here/mask-errors.awk" | sed 's/^/restore_error=/' || true
  exit 0
fi

on_copy() {
  in_drill "$drill" psql -X -q -v ON_ERROR_STOP=1 -At -U "$owner" -d "$db" -c "$1"
}
# The timeouts keep a slow drill from holding locks the app is waiting on.
on_live() {
  docker exec \
    -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10s -c lock_timeout=2s' \
    "$live_id" psql -X -q -v ON_ERROR_STOP=1 -At -U "$owner" -d "$db" -c "$1"
}
# Assigned before they're printed, so a failed query stops the script
# (set -e) instead of printing an empty value on both sides, which would match.
both() {
  local copy live
  copy=$(on_copy "$2")
  live=$(on_live "$2")
  emit "${1}_backup" "$copy"
  emit "${1}_live" "$live"
}

say "comparing with the live database"
version=$(on_copy 'show server_version')
emit server_version "$version"
# quote_ident: a name with a comma in it can't pass for two tables.
both tables "select string_agg(quote_ident(tablename), ',' order by tablename) from pg_tables where schemaname = 'public'"
both migrations "select count(*) || ' ' || coalesce(max(created_at), 0) from drizzle.__drizzle_migrations"
# One hash over every column (its full type: length, precision, enum),
# constraint, index and enum by its definition, the money and trxID
# backstops among them (invariants 1 and 3). Column positions are left out:
# a restore closes the gaps a dropped column leaves.
both schema "select md5(string_agg(d, E'\n' order by d)) from (
  select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as d
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and a.attnum > 0 and not a.attisdropped
  union all
  select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select indexdef from pg_indexes where schemaname = 'public'
  union all
  select t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_enum e join pg_type t on t.oid = e.enumtypid group by t.typname
) s"

# The app never deletes an order, an audit row or a ticket, so every row
# up to the backup's last audit entry must still be live, and no more.
# The cutoff comes from the backup, which anyone holding the Dokploy key can
# write, and these queries run on live: so it crosses as whole microseconds,
# checked to be digits, never as text. 0 when there is no audit row yet.
cutoff_us=$(on_copy "select coalesce((extract(epoch from max(created_at)) * 1000000)::bigint, 0) from order_events")
[[ $cutoff_us =~ ^[0-9]+$ ]] || {
  say "the backup's last audit time is not a number"
  exit 2
}
emit cutoff_us "$cutoff_us"
cutoff="timestamptz 'epoch' + $cutoff_us * interval '1 microsecond'"
for table in orders order_events tickets; do
  both "rows_$table" "select count(*) from $table where created_at <= $cutoff"
done
# And the backup is the newest data it could be: live has no audit row
# between the backup's last one and shortly before the file reached S3. The
# 15 minutes cover the time the dump and the upload take. Without this, an
# old file uploaded again would pass every count above.
newer=$(on_live "select count(*) from order_events where created_at > $cutoff
  and created_at < to_timestamp($upload) - interval '15 minutes'")
emit tail_live "$newer"

# RUNBOOK → Restore from backup gives the app its rights back from the repo,
# not from the backup (--no-acl). Prove that step works on this schema.
in_drill -i "$drill" psql -X -q -v ON_ERROR_STOP=1 -U "$owner" -d "$db" \
  <"$here/app-role.sql" >/dev/null
if n=$(on_copy 'set role echoandaura_app; select count(*) from orders' 2>/dev/null); then
  emit grants "ok $n"
else
  emit grants failed
fi
# And that the audit trails stay append-only for it (invariant 6), on the
# copy and on live: how many of the rights app-role.sql revokes it still has.
both audit_writable "select count(*) from unnest(array['order_events', 'door_scans', 'door_decisions']) t
  cross join unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) p
  where has_table_privilege('echoandaura_app', t, p)"

emit done ok
