#!/usr/bin/env python3
"""
PAI App 정적 검증 테스트
실행: python3 test/static_checks.py
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent.parent
APP_SRC = ROOT / "app/src/main/java/com/amazon/paidatacollector"
RES = ROOT / "app/src/main/res"

passed = 0
failed = 0

def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✅ {name}")
        passed += 1
    except AssertionError as e:
        print(f"  ❌ {name}: {e}")
        failed += 1
    except Exception as e:
        print(f"  ❌ {name}: {type(e).__name__}: {e}")
        failed += 1

# ── 필수 파일 존재 검증 ───────────────────────────────────────────────────────

print("\n=== Required Files ===\n")

REQUIRED_FILES = [
    APP_SRC / "sensor/SensorRecorder.kt",
    APP_SRC / "ui/MainActivity.kt",
    APP_SRC / "ui/LoginActivity.kt",
    APP_SRC / "ui/SettingsActivity.kt",
    APP_SRC / "data/Database.kt",
    APP_SRC / "upload/UploadWorker.kt",
    APP_SRC / "PAIApp.kt",
    APP_SRC / "AwsConfig.kt",
    ROOT / "infra/lib/pai-stack.ts",
    ROOT / "infra/test/lambda.test.js",
    ROOT / "infra/test/lambda-core.js",
    RES / "layout/activity_main.xml",
    RES / "layout/activity_login.xml",
    RES / "layout/activity_settings.xml",
    RES / "values/strings.xml",
    RES / "xml/file_paths.xml",
    ROOT / "app/src/main/AndroidManifest.xml",
]

for f in REQUIRED_FILES:
    name = str(f.relative_to(ROOT))
    if f.exists():
        print(f"  ✅ {name}")
        passed += 1
    else:
        print(f"  ❌ {name}: MISSING")
        failed += 1

# ── AwsConfig.kt ─────────────────────────────────────────────────────────────

print("\n=== AwsConfig.kt ===\n")

aws_config = (APP_SRC / "AwsConfig.kt").read_text()

def check_aws_config():
    for key in ("REGION", "BUCKET_NAME", "USER_POOL_ID", "USER_POOL_CLIENT", "IDENTITY_POOL_ID"):
        assert key in aws_config, f"{key} constant missing"
    assert "ap-northeast-2" in aws_config, "Region ap-northeast-2 missing"

test("has all 5 required constants", check_aws_config)

# ── strings.xml scenarios ─────────────────────────────────────────────────────

print("\n=== strings.xml Scenarios ===\n")

EXPECTED_SCENARIOS = {"logistics", "assembly", "welding", "autonomous", "inspection", "other"}

def check_scenarios():
    tree = ET.parse(RES / "values/strings.xml")
    arr = tree.getroot().find(".//string-array[@name='scenarios']")
    assert arr is not None, "scenarios string-array not found"
    items = {item.text for item in arr.findall("item")}
    missing = EXPECTED_SCENARIOS - items
    assert not missing, f"missing scenarios: {missing}"
    return items

test("scenarios array exists with all expected values", check_scenarios)
test("scenarios count >= 5", lambda: (
    (_ for _ in ()).throw(AssertionError(f"only {len(check_scenarios())} scenarios"))
    if len(check_scenarios()) < 5 else None
))

# ── AndroidManifest.xml ───────────────────────────────────────────────────────

print("\n=== AndroidManifest.xml ===\n")

REQUIRED_PERMISSIONS = [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.ACCESS_FINE_LOCATION",
]

def check_manifest():
    tree = ET.parse(ROOT / "app/src/main/AndroidManifest.xml")
    root = tree.getroot()
    ns = "http://schemas.android.com/apk/res/android"
    declared = {p.get(f"{{{ns}}}name") for p in root.findall("uses-permission")}
    for perm in REQUIRED_PERMISSIONS:
        assert perm in declared, f"missing permission: {perm}"

test("all required permissions declared (incl. ACCESS_FINE_LOCATION)", check_manifest)

def check_manifest_activities():
    tree = ET.parse(ROOT / "app/src/main/AndroidManifest.xml")
    root = tree.getroot()
    ns = "http://schemas.android.com/apk/res/android"
    activities = {a.get(f"{{{ns}}}name") for a in root.find("application").findall("activity")}
    assert ".ui.LoginActivity" in activities, "LoginActivity not declared"
    assert ".ui.MainActivity" in activities, "MainActivity not declared"
    assert ".ui.SettingsActivity" in activities, "SettingsActivity not declared"

test("LoginActivity, MainActivity, SettingsActivity declared", check_manifest_activities)

def check_launcher_activity():
    tree = ET.parse(ROOT / "app/src/main/AndroidManifest.xml")
    root = tree.getroot()
    ns = "http://schemas.android.com/apk/res/android"
    for activity in root.findall(".//activity"):
        for intent_filter in activity.findall("intent-filter"):
            actions = [a.get(f"{{{ns}}}name") for a in intent_filter.findall("action")]
            if "android.intent.action.MAIN" in actions:
                name = activity.get(f"{{{ns}}}name")
                assert "LoginActivity" in name, f"Launcher should be LoginActivity, got {name}"
                return
    raise AssertionError("No MAIN launcher activity found")

test("LoginActivity is the launcher", check_launcher_activity)

# ── file_paths.xml ────────────────────────────────────────────────────────────

print("\n=== file_paths.xml ===\n")

def check_file_paths():
    tree = ET.parse(RES / "xml/file_paths.xml")
    paths = tree.getroot().findall("external-files-path")
    assert len(paths) > 0, "external-files-path not found"
    assert any(p.get("path") == "." for p in paths), "path='.' not found"

test("external-files-path covers all externalFilesDir files", check_file_paths)

# ── Kotlin 소스 패턴 검증 ─────────────────────────────────────────────────────

print("\n=== Kotlin Source Checks ===\n")

def check_no_cacheDir_for_zip():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    zip_lines = [l for l in main_kt.split('\n') if 'cacheDir' in l and 'zip' in l.lower()]
    assert not zip_lines, f"cacheDir still used for zip: {zip_lines}"

test("zipFile not stored in cacheDir", check_no_cacheDir_for_zip)

def check_dispatchers_io():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    assert "Dispatchers.IO" in main_kt, "File I/O not on Dispatchers.IO"

test("file I/O uses Dispatchers.IO", check_dispatchers_io)

def check_no_gson_in_main():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    assert "import com.google.gson" not in main_kt, "Gson still imported in MainActivity"
    assert "val gson" not in main_kt, "Gson instance still in MainActivity"

test("Gson removed from MainActivity", check_no_gson_in_main)

def check_s3_prefixes():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    assert '"video/$' in main_kt or '"video/' in main_kt, "video/ prefix missing"
    assert '"data/$' in main_kt or '"data/' in main_kt, "data/ prefix missing"
    assert '"sensor/' not in main_kt, "legacy sensor/ prefix still present"
    assert '"metadata/' not in main_kt, "legacy metadata/ prefix still present"

test("S3 keys use video/ and data/ prefixes (no legacy sensor/metadata/)", check_s3_prefixes)

def check_zip_entries():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    assert 'ZipEntry("sensor.csv")' in main_kt, "sensor.csv not in zip"
    assert 'ZipEntry("metadata.csv")' in main_kt, "metadata.csv not in zip"

test("zip contains sensor.csv and metadata.csv entries", check_zip_entries)

def check_new_password_handling():
    login_kt = (APP_SRC / "ui/LoginActivity.kt").read_text()
    assert "NEW_PASSWORD_REQUIRED" in login_kt, "NEW_PASSWORD_REQUIRED not handled"
    assert "confirmSignIn" in login_kt, "confirmSignIn not called"
    assert "AlertDialog" in login_kt, "AlertDialog not used for password change"

test("LoginActivity handles NEW_PASSWORD_REQUIRED", check_new_password_handling)

def check_db_version():
    db_kt = (APP_SRC / "data/Database.kt").read_text()
    assert "version = 2" in db_kt, "DB version should be 2"
    assert "fallbackToDestructiveMigration" in db_kt, "fallbackToDestructiveMigration missing"

test("Database version=2 with fallbackToDestructiveMigration", check_db_version)

def check_sensor_csv_header():
    sensor_kt = (APP_SRC / "sensor/SensorRecorder.kt").read_text()
    expected_cols = [
        "timestampMs", "accel_x", "accel_y", "accel_z",
        "gyro_x", "gyro_y", "gyro_z",
        "mag_x", "mag_y", "mag_z",
        "gravity_x", "gravity_y", "gravity_z",
        "linear_accel_x", "linear_accel_y", "linear_accel_z",
        "rot_x", "rot_y", "rot_z", "rot_w", "rot_heading_accuracy",
        "pressure", "light", "proximity",
        "lat", "lng", "alt", "speed", "bearing", "gps_accuracy",
    ]
    for col in expected_cols:
        assert col in sensor_kt, f"CSV column missing: {col}"
    assert "Gson" not in sensor_kt, "Gson still in SensorRecorder"

test("SensorRecorder CSV has all 30 columns, no Gson", check_sensor_csv_header)

def check_sensor_gps():
    sensor_kt = (APP_SRC / "sensor/SensorRecorder.kt").read_text()
    assert "LocationManager" in sensor_kt, "LocationManager missing in SensorRecorder"
    assert "LocationListener" in sensor_kt, "LocationListener missing in SensorRecorder"
    assert "onLocationChanged" in sensor_kt, "onLocationChanged not implemented"

test("SensorRecorder implements GPS via LocationManager", check_sensor_gps)

def check_settings_activity():
    settings_kt = (APP_SRC / "ui/SettingsActivity.kt").read_text()
    assert "SharedPreferences" in settings_kt or "getSharedPreferences" in settings_kt, "SharedPreferences missing"
    assert "KEY_SPLIT_INTERVAL_MS" in settings_kt, "KEY_SPLIT_INTERVAL_MS missing"
    assert "INTERVAL_MS" in settings_kt, "INTERVAL_MS array missing"

test("SettingsActivity has SharedPreferences + interval constants", check_settings_activity)

def check_main_split_timer():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    assert "CountDownTimer" in main_kt, "CountDownTimer missing in MainActivity"
    assert "segmentIndex" in main_kt, "segmentIndex missing"
    assert "tvSegmentInfo" in main_kt, "tvSegmentInfo UI element missing"
    assert "btnSettings" in main_kt, "btnSettings missing"
    assert "ACCESS_FINE_LOCATION" in main_kt, "ACCESS_FINE_LOCATION permission request missing"

test("MainActivity has CountDownTimer, segmentIndex, tvSegmentInfo, btnSettings, location perm", check_main_split_timer)

def check_segment_filename():
    main_kt = (APP_SRC / "ui/MainActivity.kt").read_text()
    # sessionPrefix + segLabel pattern
    assert "sessionPrefix" in main_kt, "sessionPrefix missing"
    assert '"%03d"' in main_kt or "format(segmentIndex)" in main_kt, "segment index formatting missing"

test("MainActivity uses sessionPrefix + segment index for filenames", check_segment_filename)

# ── infra 검증 ────────────────────────────────────────────────────────────────

print("\n=== Infra (pai-stack.ts) Checks ===\n")

stack_ts = (ROOT / "infra/lib/pai-stack.ts").read_text()

test("S3 trigger prefix is data/ (not metadata/)", lambda: (
    (_ for _ in ()).throw(AssertionError("trigger still uses metadata/"))
    if "prefix: 'metadata/'" in stack_ts else None
) or (
    (_ for _ in ()).throw(AssertionError("data/ trigger missing"))
    if "prefix: 'data/'" not in stack_ts else None
))

test("IAM policy has data/ prefix (not sensor/ or metadata/)", lambda: (
    (_ for _ in ()).throw(AssertionError("legacy sensor/ IAM prefix"))
    if "/sensor/" in stack_ts and "PutObject" in stack_ts else None
))

test("Lambda parseMetadataCsv has empty-CSV guard", lambda: (
    (_ for _ in ()).throw(AssertionError("no empty-CSV guard in Lambda"))
    if "lines.length < 2" not in stack_ts else None
))

test("Lambda uses zlib (no external zip deps)", lambda: (
    (_ for _ in ()).throw(AssertionError("adm-zip or unzipper dependency found"))
    if "adm-zip" in stack_ts or "unzipper" in stack_ts else None
))

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{'─' * 50}")
print(f"Results: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
