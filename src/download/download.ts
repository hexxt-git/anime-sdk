import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Stream, Pages } from '../types.js';

export interface DownloadVideoOptions {
  /** Called with phase/detail strings as the download progresses. */
  onProgress?: (info: { phase: string; detail?: string }) => void;
  /** Overall ffmpeg timeout in ms (default 300000). */
  timeoutMs?: number;
  /** Override stream headers (defaults to `stream.headers`). */
  headers?: Record<string, string>;
}

export interface DownloadVideoResult {
  outputPath: string;
  fileSize: number;
}

export interface DownloadMangaPageOptions {
  headers?: Record<string, string>;
  /** Single-page fetch timeout in ms (default 30000). */
  timeoutMs?: number;
}

export interface DownloadMangaPageResult {
  outputPath: string;
  pageIndex: number;
  fileSize: number;
  contentType: string;
}

export interface DownloadMangaChapterOptions {
  onProgress?: (info: { downloaded: number; total: number }) => void;
  /** Per-page fetch timeout in ms (default 30000). */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface DownloadMangaChapterResult {
  outputPath: string;
  pageCount: number;
  fileSize: number;
}

// ─── HLS Helpers ─────────────────────────────────────────────────────────────

interface HlsSegment {
  url: string;
  duration: number;
}

export function parseHlsMaster(content: string, baseUrl: string): string[] {
  const variants: string[] = [];
  for (const line of content.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    try {
      variants.push(new URL(line, baseUrl).toString());
    } catch {
      variants.push(line);
    }
  }
  return variants;
}

export function parseHlsSegments(content: string, baseUrl: string): HlsSegment[] {
  const segments: HlsSegment[] = [];
  let dur = 0;
  for (const line of content.split('\n').map((l) => l.trim())) {
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/#EXTINF:([0-9.]+)/);
      if (m) dur = parseFloat(m[1]);
    } else if (line && !line.startsWith('#')) {
      try {
        segments.push({ url: new URL(line, baseUrl).toString(), duration: dur });
      } catch {
        segments.push({ url: line, duration: dur });
      }
    }
  }
  return segments;
}

export function detectImageExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('bmp')) return '.bmp';
  if (ct.includes('avif')) return '.avif';
  return '.jpg';
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'User-Agent': DEFAULT_UA, ...(extra ?? {}) };
}

// ─── Video Download ─────────────────────────────────────────────────────────

export async function downloadVideo(
  stream: Stream,
  outputPath: string,
  options?: DownloadVideoOptions,
): Promise<DownloadVideoResult> {
  const headers = options?.headers ?? stream.headers ?? {};

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const timeout = options?.timeoutMs ?? 300_000;

  let target = stream.url;
  let hls = stream.isHls;

  if (!hls && !target.includes('.m3u8') && !target.includes('.mp4')) {
    const probed = await probeIsVideo(target, headers);
    if (!probed.isVideo) {
      const scraped = await scrapeForStreamUrl(target, headers);
      if (scraped) {
        target = scraped.url;
        hls = scraped.isHls;
      }
    }
  }

  options?.onProgress?.({
    phase: 'resolving',
    detail: `Downloading: ${target.slice(0, 120)}`,
  });

  if (hls || target.includes('.m3u8')) {
    options?.onProgress?.({
      phase: 'downloading',
      detail: 'Downloading HLS segments',
    });
    await downloadHlsSegments(target, outputPath, headers, timeout, options?.onProgress);
  } else {
    options?.onProgress?.({ phase: 'downloading', detail: 'Downloading MP4 directly' });
    await downloadMp4Direct(target, outputPath, headers, timeout);
  }

  const stat = fs.statSync(outputPath);
  if (stat.size < 1024) {
    throw new Error(`Downloaded file is too small (${stat.size} bytes)`);
  }

  options?.onProgress?.({ phase: 'complete', detail: outputPath });
  return { outputPath, fileSize: stat.size };
}

async function probeIsVideo(
  url: string,
  headers: Record<string, string>,
): Promise<{ isVideo: boolean }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...mergeHeaders(headers), Range: 'bytes=0-2048' },
    });
    if (res.status !== 200 && res.status !== 206) return { isVideo: false };
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.startsWith('text/html') || ct.startsWith('application/xhtml')) return { isVideo: false };
    if (
      ct.startsWith('video/') ||
      ct.includes('mpegurl') ||
      ct.includes('mp2t') ||
      ct.startsWith('application/octet-stream')
    ) {
      return { isVideo: true };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
      return { isVideo: true };
    }
    return { isVideo: false };
  } catch {
    return { isVideo: false };
  }
}

async function scrapeForStreamUrl(
  pageUrl: string,
  headers: Record<string, string>,
): Promise<{ url: string; isHls: boolean } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let html = '';
    try {
      const res = await fetch(pageUrl, {
        headers: mergeHeaders(headers),
        signal: ctrl.signal,
      });
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const pickFirst = (text: string, re: RegExp): string | null => {
      const a = text.match(re);
      if (a) return a[0];
      const b = text.replace(/\\\//g, '/').match(re);
      return b ? b[0] : null;
    };

    const m3u8 = pickFirst(
      html,
      /https?:\/\/[^"'\s<>\\]+?\/[^"'\s<>\\/]+\.m3u8(?:[?#][^"'\s<>\\]*)?/i,
    );
    if (m3u8) return { url: m3u8.replace(/&amp;/g, '&'), isHls: true };

    const mp4 = pickFirst(
      html,
      /https?:\/\/[^"'\s<>\\]+?\/[^"'\s<>\\/]+\.mp4(?:[?#][^"'\s<>\\]*)?/i,
    );
    if (mp4) return { url: mp4.replace(/&amp;/g, '&'), isHls: false };

    return null;
  } catch {
    return null;
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND_MAGIC = Buffer.from([0x49, 0x45, 0x4e, 0x44]);

// Some CDNs disguise .ts segments as PNGs to evade adblockers. Strip the
// header so ffmpeg sees a clean transport stream.
function stripPngHeader(buffer: Buffer): Buffer {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    const idx = buffer.indexOf(IEND_MAGIC);
    if (idx !== -1) {
      const offset = idx + 8;
      if (offset < buffer.length) return buffer.subarray(offset);
    }
  }
  return buffer;
}

async function downloadHlsSegments(
  playlistUrl: string,
  outputPath: string,
  headers: Record<string, string>,
  timeoutMs: number,
  onProgress?: (info: { phase: string; detail?: string }) => void,
): Promise<void> {
  let currentUrl = playlistUrl;
  let res = await fetch(currentUrl, { headers: mergeHeaders(headers) });
  if (!res.ok)
    throw new Error(`Playlist ${res.status} ${res.statusText} (${currentUrl.slice(0, 120)})`);
  let playlist = await res.text();

  for (let hops = 0; hops < 2 && playlist.includes('#EXT-X-STREAM-INF'); hops++) {
    const variants = parseHlsMaster(playlist, currentUrl);
    if (variants.length === 0) throw new Error('Master playlist has no variants');
    currentUrl = variants[variants.length - 1];
    res = await fetch(currentUrl, { headers: mergeHeaders(headers) });
    if (!res.ok) throw new Error(`Variant ${res.status} (${currentUrl.slice(0, 120)})`);
    playlist = await res.text();
  }

  const segments = parseHlsSegments(playlist, currentUrl);
  if (segments.length === 0) throw new Error('No segments in playlist');

  const dir = path.dirname(outputPath);
  const tmpTs = path.join(dir, `tmp_${path.basename(outputPath, '.mp4')}_concat.ts`);

  if (fs.existsSync(tmpTs)) fs.unlinkSync(tmpTs);

  const fd = fs.openSync(tmpTs, 'a');
  try {
    for (let i = 0; i < segments.length; i++) {
      onProgress?.({ phase: 'downloading', detail: `Segment ${i + 1}/${segments.length}` });

      const seg = segments[i];
      const segRes = await fetch(seg.url, { headers: mergeHeaders(headers) });
      if (!segRes.ok) throw new Error(`Segment ${i} failed: HTTP ${segRes.status}`);

      const arrayBuf = await segRes.arrayBuffer();
      const bytes = stripPngHeader(Buffer.from(arrayBuf as ArrayBuffer));
      fs.writeSync(fd, bytes, 0, bytes.length, null);
    }
  } finally {
    fs.closeSync(fd);
  }

  onProgress?.({ phase: 'muxing', detail: 'Muxing segments to MP4 via ffmpeg' });

  const cmd = [
    'ffmpeg -y',
    '-loglevel error',
    `-i ${JSON.stringify(tmpTs)}`,
    '-c copy',
    '-movflags +faststart',
    JSON.stringify(outputPath),
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'pipe', timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: Buffer; message: string };
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`ffmpeg failed: ${err.message}\n${stderr}`);
  }

  if (fs.existsSync(tmpTs)) fs.unlinkSync(tmpTs);
}

async function downloadMp4Direct(
  mp4Url: string,
  outputPath: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(mp4Url, { headers: mergeHeaders(headers), signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if (!res.body) throw new Error('Response body is null');

    const fileStream = fs.createWriteStream(outputPath);
    const reader = res.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }
    } finally {
      fileStream.close();
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Manga Download ─────────────────────────────────────────────────────────

export async function downloadMangaPage(
  pages: Pages,
  pageIndex: number,
  outputDir: string,
  options?: DownloadMangaPageOptions,
): Promise<DownloadMangaPageResult> {
  if (pageIndex < 0 || pageIndex >= pages.pages.length) {
    throw new Error(`Page index ${pageIndex} out of range (0-${pages.pages.length - 1})`);
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const url = pages.pages[pageIndex].url;
  const headers = options?.headers ?? {};
  const timeout = options?.timeoutMs ?? 30_000;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const res = await fetch(url, { headers: mergeHeaders(headers), signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching page ${pageIndex}`);

    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const ext = detectImageExtension(contentType);
    const paddedIndex = String(pageIndex + 1).padStart(3, '0');
    const filename = `page_${paddedIndex}${ext}`;
    const outputPath = path.join(outputDir, filename);

    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buf);

    return { outputPath, pageIndex, fileSize: buf.length, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadMangaChapter(
  pages: Pages,
  outputPath: string,
  options?: DownloadMangaChapterOptions,
): Promise<DownloadMangaChapterResult> {
  if (pages.pages.length === 0) {
    throw new Error('downloadMangaChapter: no pages to download');
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const headers = options?.headers ?? {};
  const timeout = options?.timeoutMs ?? 30_000;
  const entries: ZipEntry[] = [];

  for (let i = 0; i < pages.pages.length; i++) {
    options?.onProgress?.({ downloaded: i, total: pages.pages.length });

    const url = pages.pages[i].url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch(url, { headers: mergeHeaders(headers), signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching page ${i}`);

      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const ext = detectImageExtension(contentType);
      const paddedIndex = String(i + 1).padStart(3, '0');
      const filename = `${paddedIndex}${ext}`;

      const data = Buffer.from(await res.arrayBuffer());
      entries.push({ filename, data });
    } finally {
      clearTimeout(timer);
    }
  }

  options?.onProgress?.({ downloaded: pages.pages.length, total: pages.pages.length });

  const zipBuffer = createZipBuffer(entries);
  fs.writeFileSync(outputPath, zipBuffer);

  return { outputPath, pageCount: entries.length, fileSize: zipBuffer.length };
}

// ─── Minimal ZIP Writer (STORE, no compression) ─────────────────────────────
// Images are already compressed (JPEG/PNG/WebP), so STORE is optimal.

interface ZipEntry {
  filename: string;
  data: Buffer;
}

const crc32Table: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crc32Table[i] = c;
}

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centralDirEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.filename, 'utf8');
    const crcVal = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crcVal, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    parts.push(local, entry.data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crcVal, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    centralDirEntries.push(central);

    offset += local.length + entry.data.length;
  }

  const centralDirOffset = offset;
  const centralDir = Buffer.concat(centralDirEntries);
  const centralDirSize = centralDir.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  parts.push(centralDir, eocd);
  return Buffer.concat(parts);
}
