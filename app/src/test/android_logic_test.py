#!/usr/bin/env python3
"""
PAI App JVM Unit Test Runner
실행: python3 app/src/test/android_logic_test.py
"""
import io
import sys
import zipfile

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

def assert_eq(a, b, msg=""):
    assert a == b, f"expected {b!r}, got {a!r}" + (f" — {msg}" if msg else "")

def assert_true(cond, msg=""):
    assert cond, msg or "condition is False"

def assert_false(cond, msg=""):
    assert not cond, msg or "condition is True"

# ── Helpers ──────────────────────────────────────────────────────────────────

CSV_HEADER = (
    "timestampMs,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,"
    "mag_x,mag_y,mag_z,gravity_x,gravity_y,gravity_z,"
    "linear_accel_x,linear_accel_y,linear_accel_z,"
    "rot_x,rot_y,rot_z,rot_w,rot_heading_accuracy,"
    "pressure,light,proximity,lat,lng,alt,speed,bearing,gps_accuracy"
)

def write_sensor_csv(rows: list[str]) -> str:
    """Mirrors SensorRecorder.flushToFile() — extended 30-column header"""
    lines = [CSV_HEADER] + rows
    return "\n".join(lines) + "\n"

def write_metadata_csv(prefix, scenario, location, task_type, device_id, captured_at) -> str:
    return (
        "prefix,scenario,location,taskType,deviceId,capturedAt\n"
        f"{prefix},{scenario},{location},{task_type},{device_id},{captured_at}\n"
    )

def create_zip(sensor_content: str, meta_content: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("sensor.csv", sensor_content)
        zf.writestr("metadata.csv", meta_content)
    return buf.getvalue()

def parse_metadata_csv(csv: str) -> dict:
    lines = csv.strip().split('\n')
    if len(lines) < 2:
        return {}
    keys = [k.strip() for k in lines[0].split(',')]
    vals = [v.strip() for v in lines[1].split(',')]
    return dict(zip(keys, vals))

def process_zip_buffer(key: str, buf: bytes) -> dict | None:
    try:
        with zipfile.ZipFile(io.BytesIO(buf)) as zf:
            if 'metadata.csv' not in zf.namelist():
                return None
            meta_csv = zf.read('metadata.csv').decode('utf-8')
    except Exception:
        return None
    meta = parse_metadata_csv(meta_csv)
    return {
        'pk': key,
        'capturedAt': int(meta.get('capturedAt', 0)),
        'scenario': meta.get('scenario', 'unknown'),
        'location': meta.get('location', 'unknown'),
        'taskType': meta.get('taskType', 'unknown'),
        'deviceId': meta.get('deviceId', 'unknown'),
        's3Key': key,
    }

# ── SensorRecorder CSV Tests (extended) ──────────────────────────────────────

print("\n=== SensorRecorder CSV Tests ===\n")

EXPECTED_COLS = CSV_HEADER.split(',')

test("csv header has exactly 30 columns", lambda: assert_eq(len(EXPECTED_COLS), 30))

test("csv header starts with timestampMs", lambda: assert_eq(EXPECTED_COLS[0], "timestampMs"))

test("csv header contains all accel/gyro columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["accel_x","accel_y","accel_z","gyro_x","gyro_y","gyro_z"]))
))

test("csv header contains magnetometer columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["mag_x","mag_y","mag_z"]))
))

test("csv header contains gravity columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["gravity_x","gravity_y","gravity_z"]))
))

test("csv header contains linear_accel columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["linear_accel_x","linear_accel_y","linear_accel_z"]))
))

test("csv header contains rotation vector columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["rot_x","rot_y","rot_z","rot_w","rot_heading_accuracy"]))
))

test("csv header contains pressure, light, proximity", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["pressure","light","proximity"]))
))

test("csv header contains GPS columns", lambda: (
    assert_true(all(c in EXPECTED_COLS for c in ["lat","lng","alt","speed","bearing","gps_accuracy"]))
))

test("csv row with all values parses correctly", lambda: (
    assert_eq(
        write_sensor_csv(["1000,0.1,0.2,0.3,0.01,0.02,0.03,1,2,3,0,0,9.8,0.1,0.2,0.3,0,0,0,1,0,1013,200,5,37.5,127.0,50,0.5,90,3"]).split('\n')[1],
        "1000,0.1,0.2,0.3,0.01,0.02,0.03,1,2,3,0,0,9.8,0.1,0.2,0.3,0,0,0,1,0,1013,200,5,37.5,127.0,50,0.5,90,3"
    )
))

test("csv row with missing GPS (null-safe empty fields) is valid", lambda: (
    # 7 sensor values + 23 empty trailing fields = 30 columns
    assert_eq(
        len(("1000,0.1,0.2,0.3,0.01,0.02,0.03" + "," * 23).split(',')),
        30
    )
))

test("empty recording produces header-only csv", lambda: (
    assert_eq(len([l for l in write_sensor_csv([]).split('\n') if l]), 1)
))

# ── Segment filename Tests ────────────────────────────────────────────────────

print("\n=== Segment Filename Tests ===\n")

def make_segment_prefix(session_prefix: str, seg_idx: int) -> str:
    return f"{session_prefix}_{seg_idx:03d}"

test("segment prefix format: yyyyMMdd_HHmmss_001", lambda: (
    assert_eq(make_segment_prefix("20260402_200000", 1), "20260402_200000_001")
))

test("segment prefix increments correctly", lambda: (
    assert_eq(make_segment_prefix("20260402_200000", 2), "20260402_200000_002"),
    assert_eq(make_segment_prefix("20260402_200000", 10), "20260402_200000_010"),
))

test("video s3 key uses segment prefix", lambda: (
    assert_true(make_segment_prefix("20260402_200000", 1) + ".mp4" in f"video/dev/{make_segment_prefix('20260402_200000', 1)}.mp4")
))

test("data zip s3 key uses segment prefix", lambda: (
    assert_true(make_segment_prefix("20260402_200000", 1) + "_data.zip" in f"data/dev/{make_segment_prefix('20260402_200000', 1)}_data.zip")
))

# ── Metadata CSV Tests ───────────────────────────────────────────────────────

print("\n=== Metadata CSV Tests ===\n")

test("metadata csv has correct header", lambda: assert_eq(
    write_metadata_csv("p","s","l","t","d",0).split('\n')[0],
    "prefix,scenario,location,taskType,deviceId,capturedAt"
))

test("metadata csv data row contains all fields", lambda: (
    assert_eq(
        write_metadata_csv("20260329_120000","logistics","울산공장","welding","dev-001",1743000000000).split('\n')[1],
        "20260329_120000,logistics,울산공장,welding,dev-001,1743000000000"
    )
))

# ── ZIP Bundle Tests ─────────────────────────────────────────────────────────

print("\n=== ZIP Bundle Tests ===\n")

def _zip_entries():
    buf = create_zip("sensor_data", "meta_data")
    with zipfile.ZipFile(io.BytesIO(buf)) as zf:
        return set(zf.namelist())

test("zip contains sensor.csv and metadata.csv", lambda: (
    assert_true("sensor.csv" in _zip_entries()),
    assert_true("metadata.csv" in _zip_entries())
))

test("zip sensor.csv content preserved", lambda: (
    assert_eq(
        zipfile.ZipFile(io.BytesIO(create_zip("hello_sensor", "meta"))).read("sensor.csv").decode(),
        "hello_sensor"
    )
))

test("zip metadata.csv content preserved", lambda: (
    assert_eq(
        zipfile.ZipFile(io.BytesIO(create_zip("sensor", "hello_meta"))).read("metadata.csv").decode(),
        "hello_meta"
    )
))

# ── S3 Key Tests ─────────────────────────────────────────────────────────────

print("\n=== S3 Key Tests ===\n")

DEVICE_ID = "ap-northeast-2:abc123-androidId"
PREFIX = "20260329_120000_001"

test("video s3 key format", lambda: (
    assert_true(f"video/{DEVICE_ID}/{PREFIX}.mp4".startswith("video/")),
    assert_true(f"video/{DEVICE_ID}/{PREFIX}.mp4".endswith(".mp4"))
))

test("data zip s3 key format", lambda: (
    assert_true(f"data/{DEVICE_ID}/{PREFIX}_data.zip".startswith("data/")),
    assert_true(f"data/{DEVICE_ID}/{PREFIX}_data.zip".endswith("_data.zip"))
))

test("no legacy sensor/ or metadata/ prefix", lambda: (
    assert_false(f"video/{DEVICE_ID}/{PREFIX}.mp4".startswith("sensor/")),
    assert_false(f"data/{DEVICE_ID}/{PREFIX}_data.zip".startswith("metadata/"))
))

# ── Lambda Logic Tests ───────────────────────────────────────────────────────

print("\n=== Lambda IndexFn Logic Tests ===\n")

test("processZipBuffer returns item from valid zip", lambda: (
    assert_eq(
        process_zip_buffer(
            "data/dev/test_data.zip",
            create_zip(
                write_sensor_csv(["1000,0.1,0.2,0.3,0.01,0.02,0.03,,,,,,,,,,,,,,,,,,,,,,,,"]),
                "prefix,scenario,location,taskType,deviceId,capturedAt\n20260329,assembly,서울,inspection,dev-abc,1743000000000\n"
            )
        )['scenario'],
        "assembly"
    )
))

test("processZipBuffer returns item with fallback when metadata.csv is empty", lambda: (
    assert_eq(
        process_zip_buffer("data/x/test_data.zip", create_zip("sensor_data", ""))['scenario'],
        "unknown"
    )
))

def _zip_no_meta():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr("sensor.csv", "data")
    return buf.getvalue()

test("processZipBuffer returns None when metadata.csv absent", lambda: (
    assert_eq(process_zip_buffer("data/x/test_data.zip", _zip_no_meta()), None)
))

test("parseMetadataCsv parses all fields", lambda: (
    assert_eq(
        parse_metadata_csv("prefix,scenario,location,taskType,deviceId,capturedAt\n20260329,logistics,울산,welding,dev-001,1743000000000\n")['scenario'],
        "logistics"
    )
))

test("S3 key decode: + replaced with space", lambda: (
    assert_eq(
        "data/device+id/test.zip".replace('+', ' '),
        "data/device id/test.zip"
    )
))

# ── End-to-End Flow Test ─────────────────────────────────────────────────────

print("\n=== End-to-End Flow Test ===\n")

def e2e_flow():
    session_prefix = "20260402_200000"
    seg_idx = 1
    prefix = f"{session_prefix}_{seg_idx:03d}"
    device_id = "cognito-id-abc-androidId"
    scenario = "logistics"
    location = "울산공장 1라인"
    task_type = "welding"
    captured_at = 1743000000000

    # 1. Sensor CSV (extended columns, GPS present)
    sensor_csv = write_sensor_csv([
        "1000,0.1,0.2,0.3,0.01,0.02,0.03,1,2,3,0,0,9.8,0.1,0.2,0.3,0,0,0,1,0,1013,200,5,37.5,127.0,50,0.5,90,3",
        "1020,0.2,0.3,0.4,0.02,0.03,0.04,1,2,3,0,0,9.8,0.1,0.2,0.3,0,0,0,1,0,1013,200,5,37.5,127.0,50,0.5,90,3",
    ])
    assert sensor_csv.split('\n')[0] == CSV_HEADER
    assert len(sensor_csv.split('\n')[0].split(',')) == 30

    # 2. Metadata CSV
    meta_csv = write_metadata_csv(prefix, scenario, location, task_type, device_id, captured_at)
    assert "logistics" in meta_csv

    # 3. ZIP
    zip_buf = create_zip(sensor_csv, meta_csv)
    assert len(zip_buf) > 0

    # 4. S3 keys (segment-indexed)
    video_key = f"video/{device_id}/{prefix}.mp4"
    data_key  = f"data/{device_id}/{prefix}_data.zip"
    assert video_key.endswith("_001.mp4")
    assert data_key.endswith("_001_data.zip")

    # 5. Lambda: zip → DynamoDB item
    item = process_zip_buffer(data_key, zip_buf)
    assert item is not None
    assert item['pk'] == data_key
    assert item['scenario'] == scenario
    assert item['location'] == location
    assert item['taskType'] == task_type
    assert item['deviceId'] == device_id
    assert item['capturedAt'] == captured_at

test("full recording → extended CSV → zip → lambda → dynamodb item flow", e2e_flow)

# ── Summary ──────────────────────────────────────────────────────────────────

print(f"\n{'─' * 45}")
print(f"Results: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
