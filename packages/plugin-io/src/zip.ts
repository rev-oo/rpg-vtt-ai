import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// A small ZIP reader and writer (PKWARE APPNOTE 6.3) for `.vttplugin` archives (ADR-026).
// It covers what plugins need: stored or deflated files, UTF-8 names, no ZIP64, no encryption.

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;
/** 1980-01-01 00:00, the earliest DOS date: archives are the same for the same files. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const REGULAR_FILE = 0o100644;
const FILE_TYPE = 0o170000;
const SYMLINK = 0o120000;

/** Why an archive was refused; `reason` is stable, `message` is for logs and the CLI. */
export class ArchiveError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** Writes a ZIP archive of the given files, in the given order. */
export function writeZip(files: Iterable<readonly [name: string, data: Uint8Array]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? DEFLATED : STORED;
    const body = method === DEFLATED ? deflated : Buffer.from(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((REGULAR_FILE << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export interface ZipLimits {
  /** Files in the archive, directories included. */
  maxEntries: number;
  /** One file, unpacked. */
  maxFileBytes: number;
  /** All files, unpacked. */
  maxTotalBytes: number;
}

/**
 * A name that stays inside the folder it is unpacked into: relative, `/`-separated, with no
 * empty, `.` or `..` segment and no drive letter.
 */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  if (name.includes('\0')) return false;
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function fail(reason: string, message: string): never {
  throw new ArchiveError(reason, message);
}

/** The end-of-central-directory record, searched from the end past a comment. */
function findEnd(zip: Buffer): number {
  const earliest = Math.max(0, zip.length - 22 - 0xffff);
  for (let at = zip.length - 22; at >= earliest; at -= 1) {
    if (zip.readUInt32LE(at) === END) return at;
  }
  return fail('not_zip', 'This is not a ZIP archive.');
}

/**
 * Reads a ZIP archive into its files (directories are skipped). It refuses anything it cannot
 * unpack safely: unsafe or repeated names, links, encryption, ZIP64, other compression
 * methods, a bad checksum, or more than `limits` allow, checked before and while unpacking.
 */
export function readZip(zip: Buffer, limits: ZipLimits): Map<string, Buffer> {
  if (zip.length < 22) fail('not_zip', 'This is not a ZIP archive.');
  const end = findEnd(zip);
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const start = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 8) !== count) {
    fail('unsupported', 'Archives split over several files are not supported.');
  }
  if (count === 0xffff || start === 0xffffffff) fail('unsupported', 'ZIP64 is not supported.');
  if (count > limits.maxEntries) {
    fail('too_many_files', `The archive has more than ${String(limits.maxEntries)} files.`);
  }
  if (start + size > end) fail('corrupt', 'The archive is damaged.');

  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  let total = 0;
  let at = start;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL)
      fail('corrupt', 'The archive is damaged.');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const unpacked = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const mode = zip.readUInt32LE(at + 38) >>> 16;
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (!isSafeEntryName(name))
      fail('unsafe_name', `“${name}” would be unpacked outside the plugin folder.`);
    const key = name.toLowerCase();
    if (seen.has(key)) fail('duplicate_name', `“${name}” appears twice.`);
    seen.add(key);
    if ((mode & FILE_TYPE) === SYMLINK)
      fail('link', `“${name}” is a link; archives may only hold files.`);
    if (name.endsWith('/')) continue;
    if (flags & 0x0001) fail('encrypted', `“${name}” is encrypted.`);
    if (method !== STORED && method !== DEFLATED) {
      fail('unsupported', `“${name}” uses a compression method other than deflate.`);
    }
    if (packed === 0xffffffff || unpacked === 0xffffffff || offset === 0xffffffff) {
      fail('unsupported', 'ZIP64 is not supported.');
    }
    if (unpacked > limits.maxFileBytes) {
      fail('file_too_large', `“${name}” is larger than ${String(limits.maxFileBytes)} bytes.`);
    }
    total += unpacked;
    if (total > limits.maxTotalBytes) {
      fail('too_large', `The archive unpacks to more than ${String(limits.maxTotalBytes)} bytes.`);
    }

    if (offset + 30 > start || zip.readUInt32LE(offset) !== LOCAL)
      fail('corrupt', 'The archive is damaged.');
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    if (dataStart + packed > start) fail('corrupt', 'The archive is damaged.');
    const body = zip.subarray(dataStart, dataStart + packed);
    let data: Buffer;
    if (method === STORED) {
      data = Buffer.from(body);
    } else {
      try {
        // The central directory's size is a promise; unpacking stops past it.
        data = inflateRawSync(body, { maxOutputLength: Math.max(1, unpacked) });
      } catch {
        return fail('corrupt', `“${name}” is damaged or larger than it claims.`);
      }
    }
    if (data.length !== unpacked || crc32(data) !== crc) fail('corrupt', `“${name}” is damaged.`);
    files.set(name, data);
  }
  return files;
}
