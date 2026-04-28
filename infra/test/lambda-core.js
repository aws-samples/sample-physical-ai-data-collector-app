// Lambda handler logic extracted for local testing (no AWS SDK calls)
const zlib = require('zlib');

function streamToBuffer(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function parseMetadataCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return {};
  const keys = lines[0].split(',');
  const vals = lines[1].split(',');
  return Object.fromEntries(keys.map((k, i) => [k.trim(), vals[i]?.trim()]));
}

/**
 * Parse a ZIP buffer and return { entryName: content } map.
 * Uses only Node built-ins (zlib).
 */
function parseZip(buf) {
  let offset = 0;
  const entries = {};
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const fnLen    = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name     = buf.slice(offset + 30, offset + 30 + fnLen).toString();
    const compSize = buf.readUInt32LE(offset + 18);
    const method   = buf.readUInt16LE(offset + 8);
    const dataStart = offset + 30 + fnLen + extraLen;
    const compressed = buf.slice(dataStart, dataStart + compSize);
    entries[name] = method === 8
      ? zlib.inflateRawSync(compressed).toString()
      : compressed.toString();
    offset = dataStart + compSize;
  }
  return entries;
}

/**
 * Core handler logic — takes pre-fetched zip buffer, returns DynamoDB item or null.
 */
function processZipBuffer(key, buf) {
  const entries = parseZip(buf);
  if (!entries['metadata.csv']) return null;
  const meta = parseMetadataCsv(entries['metadata.csv']);
  return {
    pk:         key,
    capturedAt: Number(meta.capturedAt ?? Date.now()),
    scenario:   meta.scenario ?? 'unknown',
    location:   meta.location ?? 'unknown',
    taskType:   meta.taskType ?? 'unknown',
    deviceId:   meta.deviceId ?? 'unknown',
    s3Key:      key,
  };
}

module.exports = { parseMetadataCsv, parseZip, processZipBuffer };
