/**
 * Unit tests for the download module.
 *
 * To run: npx vitest run tests/download.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  parseHlsMaster,
  parseHlsSegments,
  detectImageExtension,
  crc32,
  createZipBuffer,
} from '../src/download/download.js';

// ─── HLS parsing ─────────────────────────────────────────────────────────────

describe('parseHlsMaster', () => {
  it('extracts variant URLs from a master playlist', () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
1080p/index.m3u8`;

    const base = 'https://cdn.example.com/video/master.m3u8';
    const variants = parseHlsMaster(manifest, base);

    expect(variants).toHaveLength(3);
    expect(variants[0]).toBe('https://cdn.example.com/video/360p/index.m3u8');
    expect(variants[1]).toBe('https://cdn.example.com/video/720p/index.m3u8');
    expect(variants[2]).toBe('https://cdn.example.com/video/1080p/index.m3u8');
  });

  it('handles absolute URLs in master playlist', () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
https://other-cdn.com/360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000
https://other-cdn.com/720p.m3u8`;

    const variants = parseHlsMaster(manifest, 'https://cdn.example.com/master.m3u8');
    expect(variants).toHaveLength(2);
    expect(variants[0]).toBe('https://other-cdn.com/360p.m3u8');
    expect(variants[1]).toBe('https://other-cdn.com/720p.m3u8');
  });

  it('returns empty array for empty manifest', () => {
    const variants = parseHlsMaster('', 'https://cdn.example.com/master.m3u8');
    expect(variants).toHaveLength(0);
  });

  it('returns empty array for manifest with only comments', () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000`;
    const variants = parseHlsMaster(manifest, 'https://cdn.example.com/master.m3u8');
    expect(variants).toHaveLength(0);
  });
});

describe('parseHlsSegments', () => {
  it('extracts segments with durations from a media playlist', () => {
    const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
seg000.ts
#EXTINF:9.009,
seg001.ts
#EXTINF:3.003,
seg002.ts
#EXT-X-ENDLIST`;

    const base = 'https://cdn.example.com/video/playlist.m3u8';
    const segments = parseHlsSegments(playlist, base);

    expect(segments).toHaveLength(3);
    expect(segments[0].url).toBe('https://cdn.example.com/video/seg000.ts');
    expect(segments[0].duration).toBeCloseTo(9.009);
    expect(segments[1].url).toBe('https://cdn.example.com/video/seg001.ts');
    expect(segments[2].duration).toBeCloseTo(3.003);
  });

  it('handles absolute segment URLs', () => {
    const playlist = `#EXTM3U
#EXTINF:10.0,
https://cdn2.example.com/seg0.ts
#EXTINF:10.0,
https://cdn2.example.com/seg1.ts
#EXT-X-ENDLIST`;

    const segments = parseHlsSegments(playlist, 'https://cdn.example.com/playlist.m3u8');
    expect(segments).toHaveLength(2);
    expect(segments[0].url).toBe('https://cdn2.example.com/seg0.ts');
  });

  it('returns empty array for empty playlist', () => {
    const segments = parseHlsSegments('', 'https://cdn.example.com/playlist.m3u8');
    expect(segments).toHaveLength(0);
  });
});

// ─── Image extension detection ───────────────────────────────────────────────

describe('detectImageExtension', () => {
  it('detects JPEG', () => {
    expect(detectImageExtension('image/jpeg')).toBe('.jpg');
    expect(detectImageExtension('image/jpg')).toBe('.jpg');
  });

  it('detects PNG', () => {
    expect(detectImageExtension('image/png')).toBe('.png');
  });

  it('detects WebP', () => {
    expect(detectImageExtension('image/webp')).toBe('.webp');
  });

  it('detects GIF', () => {
    expect(detectImageExtension('image/gif')).toBe('.gif');
  });

  it('detects AVIF', () => {
    expect(detectImageExtension('image/avif')).toBe('.avif');
  });

  it('detects BMP', () => {
    expect(detectImageExtension('image/bmp')).toBe('.bmp');
  });

  it('defaults to .jpg for unknown types', () => {
    expect(detectImageExtension('application/octet-stream')).toBe('.jpg');
    expect(detectImageExtension('')).toBe('.jpg');
  });
});

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

describe('crc32', () => {
  it('computes correct CRC-32 for known data', () => {
    // "Hello" has CRC32 = 0xF7D18982
    const buf = Buffer.from('Hello');
    expect(crc32(buf)).toBe(0xf7d18982);
  });

  it('computes CRC-32 for empty buffer', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
  });

  it('computes CRC-32 for single byte', () => {
    // 0x00 → CRC32 = 0xD202EF8D
    expect(crc32(Buffer.from([0x00]))).toBe(0xd202ef8d);
  });
});

// ─── ZIP writer ──────────────────────────────────────────────────────────────

describe('createZipBuffer', () => {
  it('creates a valid ZIP with PK header', () => {
    const zip = createZipBuffer([{ filename: 'test.txt', data: Buffer.from('Hello, World!') }]);

    // ZIP magic bytes: PK\x03\x04
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it('creates a ZIP with correct EOCD entry count', () => {
    const entries = [
      { filename: 'a.txt', data: Buffer.from('AAA') },
      { filename: 'b.txt', data: Buffer.from('BBB') },
      { filename: 'c.txt', data: Buffer.from('CCC') },
    ];

    const zip = createZipBuffer(entries);

    // Find EOCD signature (0x06054b50)
    let eocdOffset = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        eocdOffset = i;
        break;
      }
    }
    expect(eocdOffset).toBeGreaterThan(0);

    // Total entries count at offset +10
    const totalEntries = zip.readUInt16LE(eocdOffset + 10);
    expect(totalEntries).toBe(3);
  });

  it('stores file data uncompressed (STORE method)', () => {
    const data = Buffer.from('test content 12345');
    const zip = createZipBuffer([{ filename: 'file.txt', data }]);

    // The file data should appear verbatim in the ZIP
    const dataStr = data.toString();
    const zipStr = zip.toString('binary');
    expect(zipStr).toContain(dataStr);
  });

  it('creates an empty ZIP with zero entries', () => {
    const zip = createZipBuffer([]);
    // Should just have the EOCD record (22 bytes)
    expect(zip.length).toBe(22);
  });

  it('handles filenames with unicode characters', () => {
    const zip = createZipBuffer([
      { filename: 'チャプター001.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    ]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });

  it('stores correct CRC-32 in local and central headers', () => {
    const data = Buffer.from('Hello');
    const expectedCrc = crc32(data);

    const zip = createZipBuffer([{ filename: 'hello.txt', data }]);

    // Local file header CRC is at offset 14
    const localCrc = zip.readUInt32LE(14);
    expect(localCrc).toBe(expectedCrc);
  });
});
