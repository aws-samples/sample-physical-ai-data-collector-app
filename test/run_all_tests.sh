#!/usr/bin/env bash
# PAI App 로컬 테스트 실행 스크립트
# 실행: bash test/run_all_tests.sh
# Android SDK / 실기기 불필요

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

run() {
  local label="$1"; shift
  echo ""
  echo "▶ $label"
  if "$@"; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "  FAILED: $label"
  fi
}

# 1. Kotlin 정적 분석 (ktlint)
if command -v ktlint &>/dev/null; then
  run "Kotlin lint (ktlint)" bash -c "cd '$ROOT' && ktlint 'app/src/main/java/**/*.kt' && echo '  ✅ No lint errors'"
else
  echo ""
  echo "⚠️  ktlint not found — skipping (install: brew install ktlint)"
fi

# 2. 정적 검증 (파일 존재, Manifest, strings.xml, 소스 패턴)
run "Static checks (files, manifest, source patterns)" python3 "$ROOT/test/static_checks.py"

# 3. CDK synth (infra 구조 검증)
run "CDK synth" bash -c "cd '$ROOT/infra' && npx cdk synth > /dev/null 2>&1 && echo '  ✅ CloudFormation template generated'"

# 4. Lambda unit tests (Node.js)
run "Lambda IndexFn unit tests" node "$ROOT/infra/test/lambda.test.js"

# 5. Android app logic tests (Python)
run "Android app logic tests" python3 "$ROOT/app/src/test/android_logic_test.py"

echo ""
echo "══════════════════════════════════════════════"
echo "Test suites: $((PASS+FAIL)) total, $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════"
echo ""
echo "Not covered by local tests (requires device/deploy):"
echo "  - Android build (Android Studio → Gradle sync → Build)"
echo "  - CameraX recording, SensorManager hardware"
echo "  - S3 upload, DynamoDB indexing (needs cdk deploy + AwsConfig.kt)"
echo "  - Login flow (needs Cognito user)"
echo "══════════════════════════════════════════════"

[ $FAIL -eq 0 ] || exit 1
