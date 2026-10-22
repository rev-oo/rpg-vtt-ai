import { describe, expect, it } from 'vitest';

import { ArchiveError, isSafeEntryName, readZip, writeZip, type ZipLimits } from '../src/zip.js';

const LIMITS: ZipLimits = { maxEntries: 10, maxFileBytes: 1000, maxTotalBytes: 1500 };
const text = (value: string) => Buffer.from(value, 'utf8');

/** The reason readZip gives for refusing an archive. */
function refusal(zip: Buffer, limits = LIMITS): string {
  try {
    readZip(zip, limits);
  } catch (error) {
    if (error instanceof ArchiveError) return error.reason;
    throw error;
  }
  return 'accepted';
}

/** Offset of the first central directory entry. */
const centralStart = (zip: Buffer) => zip.readUInt32LE(zip.length - 22 + 16);

describe('writeZip and readZip (ADR-026)', () => {
  it('round-trips stored and deflated files with UTF-8 names', () => {
    const files: [string, Buffer][] = [
      ['plugin.json', text('{"id":"x"}')],
      ['lang/pt-BR.json', text(JSON.stringify({ a: 'ação' }).repeat(20))],
      ['assets/empty.txt', Buffer.alloc(0)],
      ['assets/noise.bin', Buffer.from([1, 200, 3, 4])],
    ];
    const zip = writeZip(files);
    expect([...readZip(zip, LIMITS)]).toEqual(files);
    // Same files, same bytes.
    expect(writeZip(files).equals(zip)).toBe(true);
  });

  it('skips directories', () => {
    const zip = writeZip([
      ['code/', Buffer.alloc(0)],
      ['code/client.js', text('x')],
    ]);
    expect([...readZip(zip, LIMITS).keys()]).toEqual(['code/client.js']);
  });

  it.each([
    ['../escape.json'],
    ['/etc/passwd'],
    ['a/../../b'],
    ['a\\b'],
    ['C:/x'],
    ['a//b'],
    ['./a'],
  ])('refuses the unsafe name %s', (name) => {
    expect(isSafeEntryName(name)).toBe(false);
    expect(refusal(writeZip([[name, text('x')]]))).toBe('unsafe_name');
  });

  it('refuses repeated names, ignoring case', () => {
    expect(
      refusal(
        writeZip([
          ['a.json', text('1')],
          ['A.json', text('2')],
        ]),
      ),
    ).toBe('duplicate_name');
  });

  it('refuses links and encrypted files', () => {
    const link = writeZip([['styles/x.css', text('/etc/passwd')]]);
    link.writeUInt32LE((0o120777 << 16) >>> 0, centralStart(link) + 38);
    expect(refusal(link)).toBe('link');

    const encrypted = writeZip([['a.json', text('1')]]);
    encrypted.writeUInt16LE(0x0801, centralStart(encrypted) + 8);
    expect(refusal(encrypted)).toBe('encrypted');
  });

  it('enforces the limits before unpacking', () => {
    const many = writeZip(
      Array.from({ length: 11 }, (_, i) => [`f${String(i)}`, text('x')] as const),
    );
    expect(refusal(many)).toBe('too_many_files');
    expect(refusal(writeZip([['big', Buffer.alloc(1001)]]))).toBe('file_too_large');
    const total = writeZip([
      ['a', Buffer.alloc(800)],
      ['b', Buffer.alloc(800)],
    ]);
    expect(refusal(total)).toBe('too_large');
  });

  it('stops unpacking a file that is larger than it claims', () => {
    const bomb = writeZip([['a.json', Buffer.alloc(900)]]);
    bomb.writeUInt32LE(10, centralStart(bomb) + 24);
    expect(refusal(bomb)).toBe('corrupt');
  });

  it('refuses damaged archives and other files', () => {
    const zip = writeZip([['a.json', text('{"long":"enough to deflate, enough to deflate"}')]]);
    const crc = Buffer.from(zip);
    crc.writeUInt32LE(1, centralStart(crc) + 16);
    expect(refusal(crc)).toBe('corrupt');
    expect(refusal(text('just text, not a zip archive at all'))).toBe('not_zip');
    expect(refusal(Buffer.alloc(3))).toBe('not_zip');
    expect(refusal(zip.subarray(10))).toBe('corrupt');
  });

  it('refuses compression methods other than deflate', () => {
    const zip = writeZip([['a.json', text('1')]]);
    zip.writeUInt16LE(12, centralStart(zip) + 10);
    expect(refusal(zip)).toBe('unsupported');
  });
});
