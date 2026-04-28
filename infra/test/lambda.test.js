/**
 * Lambda IndexFn 로컬 테스트
 * 실행: node test/lambda.test.js
 * 의존성 없음 — Node 내장 모듈만 사용
 */
const assert = require('assert');
const zlib = require('zlib');
const { parseMetadataCsv, parseZip, processZipBuffer } = require('./lambda-core');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

// ── Helper: create a real ZIP buffer using Node's zlib ───────────────────────

function makeZipEntry(name, content) {
  const nameBytes = Buffer.from(name);
  const contentBytes = Buffer.from(content);
  const compressed = zlib.deflateRawSync(contentBytes);

  // Local file header
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);  // signature
  header.writeUInt16LE(20, 4);           // version needed
  header.writeUInt16LE(0, 6);            // flags
  header.writeUInt16LE(8, 8);            // compression: deflate
  header.writeUInt16LE(0, 10);           // mod time
  header.writeUInt16LE(0, 12);           // mod date
  header.writeUInt32LE(0, 14);           // crc32 (skip for test)
  header.writeUInt32LE(compressed.length, 18);   // compressed size
  header.writeUInt32LE(contentBytes.length, 22); // uncompressed size
  header.writeUInt16LE(nameBytes.length, 26);    // filename length
  header.writeUInt16LE(0, 28);           // extra field length
  nameBytes.copy(header, 30);

  return Buffer.concat([header, compressed]);
}

function makeZip(files) {
  return Buffer.concat(files.map(([name, content]) => makeZipEntry(name, content)));
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== Lambda IndexFn Unit Tests ===\n');

console.log('parseMetadataCsv:');

test('parses header and single data row', () => {
  const csv = 'prefix,scenario,location,taskType,deviceId,capturedAt\n20260329_123456,logistics,울산공장,welding,device-001,1743000000000';
  const meta = parseMetadataCsv(csv);
  assert.strictEqual(meta.prefix, '20260329_123456');
  assert.strictEqual(meta.scenario, 'logistics');
  assert.strictEqual(meta.location, '울산공장');
  assert.strictEqual(meta.taskType, 'welding');
  assert.strictEqual(meta.deviceId, 'device-001');
  assert.strictEqual(meta.capturedAt, '1743000000000');
});

test('trims whitespace from keys and values', () => {
  const csv = ' prefix , scenario \n val1 , val2 ';
  const meta = parseMetadataCsv(csv);
  assert.strictEqual(meta.prefix, 'val1');
  assert.strictEqual(meta.scenario, 'val2');
});

console.log('\nparseZip:');

test('parses deflate-compressed entry', () => {
  const content = 'hello,world\nfoo,bar\n';
  const buf = makeZip([['test.csv', content]]);
  const entries = parseZip(buf);
  assert.ok(entries['test.csv'], 'entry should exist');
  assert.strictEqual(entries['test.csv'], content);
});

test('parses multiple entries', () => {
  const buf = makeZip([
    ['sensor.csv', 'ts,ax\n1000,0.1\n'],
    ['metadata.csv', 'prefix,scenario\nabc,logistics\n'],
  ]);
  const entries = parseZip(buf);
  assert.ok(entries['sensor.csv']);
  assert.ok(entries['metadata.csv']);
  assert.ok(entries['sensor.csv'].includes('1000,0.1'));
  assert.ok(entries['metadata.csv'].includes('logistics'));
});

test('returns empty object for non-zip buffer', () => {
  const entries = parseZip(Buffer.from('not a zip file'));
  assert.deepStrictEqual(entries, {});
});

console.log('\nprocessZipBuffer:');

test('returns DynamoDB item from valid zip', () => {
  const metaCsv = 'prefix,scenario,location,taskType,deviceId,capturedAt\n20260329_120000,assembly,서울,inspection,dev-abc,1743000000000';
  const buf = makeZip([
    ['sensor.csv', 'timestampMs,accel_x\n1000,0.5\n'],
    ['metadata.csv', metaCsv],
  ]);
  const key = 'data/dev-abc/20260329_120000_data.zip';
  const item = processZipBuffer(key, buf);
  assert.ok(item, 'item should not be null');
  assert.strictEqual(item.pk, key);
  assert.strictEqual(item.scenario, 'assembly');
  assert.strictEqual(item.location, '서울');
  assert.strictEqual(item.taskType, 'inspection');
  assert.strictEqual(item.deviceId, 'dev-abc');
  assert.strictEqual(item.capturedAt, 1743000000000);
  assert.strictEqual(item.s3Key, key);
});

test('returns null when metadata.csv missing from zip', () => {
  const buf = makeZip([['sensor.csv', 'ts,ax\n1000,0.1\n']]);
  const item = processZipBuffer('data/x/test_data.zip', buf);
  assert.strictEqual(item, null);
});

test('uses fallback values for missing metadata fields', () => {
  const metaCsv = 'prefix\nonly-prefix';
  const buf = makeZip([['metadata.csv', metaCsv]]);
  const item = processZipBuffer('data/x/test_data.zip', buf);
  assert.strictEqual(item.scenario, 'unknown');
  assert.strictEqual(item.location, 'unknown');
  assert.strictEqual(item.taskType, 'unknown');
  assert.strictEqual(item.deviceId, 'unknown');
});

test('S3 key decode: + replaced with space', () => {
  // Simulate what the handler does before calling processZipBuffer
  const rawKey = 'data/device+id/20260329_data.zip';
  const decoded = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  assert.strictEqual(decoded, 'data/device id/20260329_data.zip');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
