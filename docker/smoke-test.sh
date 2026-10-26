#!/usr/bin/env bash
# Checks a running compose example the way a new operator would use it (T-0703): the app is
# served, a fresh instance completes setup, the server is not root, and the data survives a
# restart. CI runs it after `docker compose up --wait`.
set -euo pipefail

compose=(docker compose -f "$(dirname "$0")/docker-compose.example.yml")
base=http://localhost:3000

expect() {
  if [[ "$2" != *"$3"* ]]; then
    echo "FAIL: $1: expected “$3” in: $2" >&2
    exit 1
  fi
  echo "ok: $1"
}

expect 'health' "$(curl -fsS "$base/api/health")" '"status":"ok"'
expect 'the app page' "$(curl -fsS "$base/")" 'http-equiv="Content-Security-Policy"'
expect 'an app route' "$(curl -fsS "$base/tables/anything")" 'http-equiv="Content-Security-Policy"'
expect 'a fresh instance' "$(curl -fsS "$base/api/v1/setup/status")" '"needsSetup":true'
expect 'setup' "$(curl -fsS -X POST -H 'content-type: application/json' \
  -d '{"username":"admin","displayName":"Admin","password":"smoke-test-password"}' \
  "$base/api/v1/setup/admin")" '"isAdmin":true'
expect 'setup is done' "$(curl -fsS "$base/api/v1/setup/status")" '"needsSetup":false'
expect 'a non-root user' "$("${compose[@]}" exec -T vtt id -u)" '1000'

"${compose[@]}" restart vtt
for _ in $(seq 1 30); do
  curl -fsS "$base/api/health" >/dev/null 2>&1 && break
  sleep 1
done
expect 'data kept across a restart' "$(curl -fsS "$base/api/v1/setup/status")" '"needsSetup":false'
