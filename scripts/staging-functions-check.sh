#!/usr/bin/env bash
# R67 Phase 1: the Pages Functions under `wrangler pages dev` (local only, port 8790) with the
# staging tier's variables. Fake, assembled service-account JSON (no real key); no AI binding.
# Proves which requests the guard admits and that tokens of the production project are refused.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${1:?work dir}
OUT=${2:?out json}
WORK="$WORK-$(date +%H%M%S)"   # a fresh directory: an earlier run's locked local state is never reused
mkdir -p "$WORK"
for d in dist functions src worker; do cp -r "$ROOT/$d" "$WORK/$d"; done
cp "$ROOT/package.json" "$WORK/"
cmd //c mklink //J "$(cygpath -w "$WORK/node_modules")" "$(cygpath -w "$ROOT/node_modules")" >/dev/null
# Staging config minus [ai] (stays local); a dummy 32-hex KV id is simulated locally by wrangler.
sed -e 's/STAGING_KV_NAMESPACE_ID/00000000000000000000000000000000/' -e '/^\[ai\]/,$d' "$ROOT/deploy/staging/wrangler.toml" > "$WORK/wrangler.toml"
KEY='-----BEGIN PRIVATE KEY----- AA== -----END PRIVATE KEY-----'
sa() { printf '{"type":"service_account","project_id":"%s","client_email":"ocr@%s.iam.gserviceaccount.com","private_key":"%s"}' "$1" "$1" "$KEY"; }
b64() { printf '%s' "$1" | base64 -w0 | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
# An unsigned token claiming the production project: must be refused everywhere.
FORGED="$(b64 '{"alg":"none","typ":"JWT"}').$(b64 "{\"iss\":\"https://securetoken.google.com/pzm-stock-x5\",\"aud\":\"pzm-stock-x5\",\"sub\":\"u1\",\"iat\":$now,\"exp\":$((now+3600))}")."
results="["
N=0
run() { # label, .dev.vars content — each case: its own port, inspector port and local state
  N=$((N+1)); local P=$((8789+N)) I=$((9239+N))
  printf '%s' "$2" > "$WORK/.dev.vars"
  (cd "$WORK" && npx --no-install wrangler pages dev dist --port $P --inspector-port $I --ip 127.0.0.1 --persist-to "state-$1" > "$WORK/dev-$1.log" 2>&1 &)
  for i in $(seq 1 90); do curl -s -m 5 -o /dev/null http://127.0.0.1:$P/ && break; sleep 1; done
  local a b c
  a=$(curl -s -m 20 -o /tmp/stg-a.json -w '%{http_code}' -X POST http://127.0.0.1:$P/api/ocr-bill -H 'content-type: application/json' -d '{"image":"data:image/jpeg;base64,AA=="}')
  b=$(curl -s -m 20 -o /tmp/stg-b.json -w '%{http_code}' -X POST http://127.0.0.1:$P/api/ocr-bill -H "authorization: Bearer $FORGED" -H 'content-type: application/json' -d '{"image":"data:image/jpeg;base64,AA=="}')
  c=$(curl -s -m 20 -o /tmp/stg-c.json -w '%{http_code}' -X POST "http://127.0.0.1:$P/api/po-image?kind=preview&po=qa" -H 'content-type: image/jpeg' --data-binary 'x')
  results+=$(printf '{"case":"%s","ocrNoToken":%s,"ocrNoTokenBody":%s,"ocrForgedProdToken":%s,"poImageNoToken":%s,"poImageBody":%s},' "$1" "$a" "$(cat /tmp/stg-a.json)" "$b" "$c" "$(cat /tmp/stg-c.json)")
  # wrangler (node) respawns workerd when it dies: stop the wrangler parent of this port first,
  # then any listener left, then wait until the port is free.
  for pid in $(powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'wrangler' -and \$_.CommandLine -match 'pages dev' -and \$_.CommandLine -match '--port $P' }).ProcessId" | tr -d '\r'); do taskkill //PID "$pid" //T //F > /dev/null 2>&1; done
  sleep 2
  for pid in $(netstat -ano | grep -E ":($P|$I) " | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID "$pid" //T //F > /dev/null 2>&1; done
  for i in $(seq 1 20); do netstat -ano | grep -q ":$P .*LISTENING" || break; sleep 1; done
}
run staging-complete "FIREBASE_SERVICE_ACCOUNT=$(sa pzm-stock-staging)"
run production-service-account "FIREBASE_SERVICE_ACCOUNT=$(sa pzm-stock-x5)"
run no-service-account ""
printf '%s]\n' "${results%,}" > "$OUT"
cat "$OUT"
