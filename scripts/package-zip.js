import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ZIP = path.join(ROOT_DIR, 'mm2-helper-bot.zip');

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'logs',
  'data',
  'db',
  'transcripts',
  'evidence',
  'secrets',
  'Unselected files',
]);

const EXCLUDED_FILES = new Set([
  '.env',
  '.DS_Store',
  'Thumbs.db',
  'mm2-helper-bot.zip',
]);

// Standard IEEE 802.3 CRC-32 lookup table for PKZIP headers
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date) {
  const yr = Math.max(1980, date.getUTCFullYear());
  const dosDate = ((yr - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  return { dosDate, dosTime };
}

function collectFiles(dir, relPrefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...collectFiles(path.join(dir, entry.name), `${relPrefix}${entry.name}/`));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue;
      if (entry.name.startsWith('.env.') && entry.name !== '.env.example') continue;
      if (entry.name.endsWith('.zip') || entry.name.endsWith('.log') || entry.name.endsWith('.pem') || entry.name.endsWith('.key')) {
        continue;
      }
      files.push({
        absPath: path.join(dir, entry.name),
        zipPath: `${relPrefix}${entry.name}`,
      });
    }
  }
  return files;
}

export function buildProjectZip(outputPath = OUTPUT_ZIP) {
  const files = collectFiles(ROOT_DIR);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.absPath);
    const stat = fs.statSync(file.absPath);
    const { dosDate, dosTime } = toDosDateTime(stat.mtime);
    const fileCrc = crc32(raw);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(file.zipPath, 'utf8');

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, body);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + body.length;
  }

  const centralBuffer = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localChunks, centralBuffer, eocd]);
  fs.writeFileSync(outputPath, archive);
  return { outputPath, fileCount: files.length, byteLength: archive.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { outputPath, fileCount, byteLength } = buildProjectZip();
  console.log(
    `[OK] Packaged ${fileCount} project files into ${path.basename(outputPath)} (${(byteLength / 1024).toFixed(1)} KB).`,
  );
}
