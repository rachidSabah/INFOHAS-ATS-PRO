#!/usr/bin/env bash
# End-to-end smoke test of workers/api (Hono + D1 local via wrangler dev).
# Validates the two critical stabilization fixes:
#   1. POST /api/resumes no longer 500s for a brand-new user (drizzle created_at fix)
#   2. GET /api/resumes returns raw snake_case rows with intact JSON content
set -u
cd /home/z/my-project/INFOHAS-ATS-PRO

echo "[1] Applying D1 migrations locally..."
npx wrangler d1 migrations apply resumeai-pro-db --local 2>&1 | tail -3

echo "[2] Starting wrangler dev (local)..."
WRANGLER_SEND_METRICS=false npx wrangler dev --port 8799 --local > /tmp/wrangler-dev.log 2>&1 &
WPID=$!

# Wait for readiness
READY=0
for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:8799/api/health" | rg -q '"ok":true'; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "FAIL: worker did not become ready"; tail -20 /tmp/wrangler-dev.log; kill $WPID 2>/dev/null; exit 1
fi
echo "  worker ready."

UID_HDR='X-User-Id: smoke_user_01'
PASS=0; FAIL=0

check() { # name, expected_pattern, actual
  if echo "$3" | rg -q "$2"; then PASS=$((PASS+1)); echo "  PASS: $1";
  else FAIL=$((FAIL+1)); echo "  FAIL: $1"; echo "    got: $(echo "$3" | head -c 400)"; fi
}

echo "[3] health"
R=$(curl -s "http://127.0.0.1:8799/api/health")
check "GET /api/health db=connected" '"db":"connected"' "$R"

echo "[4] POST /api/resumes as brand-new user (regression: was 500 via bad drizzle column)"
R=$(curl -s -X POST "http://127.0.0.1:8799/api/resumes" -H "$UID_HDR" -H "Content-Type: application/json" -d '{
  "id": "r_smoke_1", "name": "Smoke Resume", "headline": "QA Engineer",
  "contact": {"email": "smoke@test.dev", "phone": "+123"},
  "experience": [{"id":"e1","title":"Dev","company":"ACME","bullets":["Shipped things"]}],
  "skills": [{"id":"s1","name":"TypeScript","category":"core"}],
  "summary": "Solid engineer"
}')
check "POST /api/resumes ok:true" '"ok":true' "$R"

echo "[5] GET /api/resumes — content must round-trip intact (regression: was wiped)"
R=$(curl -s "http://127.0.0.1:8799/api/resumes" -H "$UID_HDR")
check "resume returned" 'Smoke Resume' "$R"
check "experience_json intact" 'Shipped things' "$R"
check "skills_json intact" 'TypeScript' "$R"
check "contact_json intact" 'smoke@test.dev' "$R"
check "raw snake_case row (name key)" '"name":"Smoke Resume"' "$R"

echo "[6] PUT /api/users/:id with lastLoginAt (regression: was dropped)"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
R=$(curl -s -X PUT "http://127.0.0.1:8799/api/users/smoke_user_01" -H "$UID_HDR" -H "Content-Type: application/json" -d "{\"lastLoginAt\":\"$NOW_ISO\",\"status\":\"approved\"}")
check "PUT /api/users/:id ok" '"ok":true' "$R"
R=$(curl -s "http://127.0.0.1:8799/api/users")
check "last_login_at persisted" "last_login_at\":\"$NOW_ISO" "$R"

echo "[7] PUT /api/settings/flags/new_flag upsert (regression: silent no-op for unseeded keys)"
R=$(curl -s -X PUT "http://127.0.0.1:8799/api/settings/flags/smoke_new_flag" -H "$UID_HDR" -H "Content-Type: application/json" -d '{"value":true}')
check "PUT flag ok" '"ok":true' "$R"
R=$(curl -s "http://127.0.0.1:8799/api/settings/flags" -H "$UID_HDR")
check "new flag persisted" '"smoke_new_flag":true' "$R"

echo "[8] PUT /api/settings/branding + GET round-trip (regression: restore read camelCase off snake row)"
R=$(curl -s -X PUT "http://127.0.0.1:8799/api/settings/branding" -H "$UID_HDR" -H "Content-Type: application/json" -d '{"appName":"SmokeBrand","primaryColor":"#123456"}')
check "PUT branding ok" '"ok":true' "$R"
R=$(curl -s "http://127.0.0.1:8799/api/settings/branding" -H "$UID_HDR")
check "branding camelCase alias appName" '"appName":"SmokeBrand"' "$R"
check "branding raw snake_case kept" '"app_name":"SmokeBrand"' "$R"

echo "[9] provider-sessions envelope"
R=$(curl -s -X PUT "http://127.0.0.1:8799/api/provider-sessions/puter" -H "$UID_HDR" -H "Content-Type: application/json" -d '{"authenticated":true,"accessToken":"tok"}')
check "PUT session ok" '"ok":true' "$R"
R=$(curl -s "http://127.0.0.1:8799/api/provider-sessions/puter")
check "GET session envelope has session.authenticated" '"authenticated":true' "$R"

echo "[10] tasks create→patch (regression: PATCH hit wrong id client-side; here verify PATCH works on server id)"
R=$(curl -s -X POST "http://127.0.0.1:8799/api/tasks/create" -H "$UID_HDR" -H "Content-Type: application/json" -d '{"type":"smoke","message":"hi"}')
check "task created" '"ok":true' "$R"
TASK_ID=$(echo "$R" | sed -n 's/.*"task":{"id":"\([^"]*\)".*/\1/p')
if [ -n "$TASK_ID" ]; then
  R=$(curl -s -X PATCH "http://127.0.0.1:8799/api/tasks/$TASK_ID" -H "$UID_HDR" -H "Content-Type: application/json" -d '{"status":"running","progress":50}')
  check "PATCH task ok" '"ok":true' "$R"
  R=$(curl -s "http://127.0.0.1:8799/api/tasks/$TASK_ID/status")
  check "task status running/50" '"status":"running","progress":50' "$R"
else
  FAIL=$((FAIL+1)); echo "  FAIL: task id not parsed from create response"
fi

kill $WPID 2>/dev/null
echo ""
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
