import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { IVideoPayload } from '../../src/types/index.js';
import type { Stream } from '../../src/types.js';

export function streamToPayload(s: Stream): IVideoPayload {
  return {
    sourceUrl: s.url,
    isHLS: s.isHls,
    quality: (s.qualities[0]?.label ?? 'auto') as IVideoPayload['quality'],
    language: s.language,
    headers: s.headers,
    subtitles: s.subtitles?.map((sub) => ({
      url: sub.url,
      language: sub.language,
      label: sub.label,
      format: sub.format,
    })),
  };
}

// ─── Small URL/parse helpers ─────────────────────────────────────────────────

interface Segment {
  url: string;
  duration: number;
}

function parseM3U8Variants(content: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const line of content.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    try {
      out.push(new URL(line, baseUrl).toString());
    } catch {
      out.push(line);
    }
  }
  return out;
}

function parseSegments(playlist: string, playlistUrl: string): Segment[] {
  const out: Segment[] = [];
  let dur = 0;
  for (const line of playlist.split('\n').map((l) => l.trim())) {
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/#EXTINF:([0-9.]+)/);
      if (m) dur = parseFloat(m[1]);
    } else if (line && !line.startsWith('#')) {
      try {
        out.push({ url: new URL(line, playlistUrl).toString(), duration: dur });
      } catch {
        out.push({ url: line, duration: dur });
      }
    }
  }
  return out;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND_MAGIC = Buffer.from([0x49, 0x45, 0x4e, 0x44]);

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

function fetchHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...headers,
  };
}

// ─── Core capture: one URL → one screenshot ─────────────────────────────────

async function captureFromUrl(outputPath: string, payload: IVideoPayload): Promise<void> {
  const headers = payload.headers ?? {};
  let target = payload.sourceUrl;
  let isHls = payload.isHLS;

  // Probe the URL itself: a direct video CDN (e.g. tools.fast4speed.rsvp, ok.ru)
  // may not have a `.mp4`/`.m3u8` extension but still serves video bytes. If a
  // GET-with-Range succeeds and returns video bytes, treat it as direct.
  // Otherwise fall back to scraping the HTML for an embedded stream URL.
  const looksDirect = /\.m3u8(?:[?#]|$)/i.test(target) || /\.mp4(?:[?#]|$)/i.test(target) || isHls;

  if (!looksDirect) {
    const probed = await probeIsVideoBytes(target, headers);
    if (!probed) {
      // Fetch as HTML and look for an embedded stream URL.
      const direct = await scrapeEmbedForStream(target, headers);
      if (!direct) {
        throw new Error(`No direct stream URL found in embed page (${target.slice(0, 120)})`);
      }
      target = direct.url;
      isHls = direct.isHls;
    }
  }

  if (isHls || target.includes('.m3u8')) {
    await captureFromHls(target, outputPath, headers);
  } else {
    await captureFromMp4(target, outputPath, headers);
  }
}

/** Returns true if the URL serves binary video content via Range probe. */
async function probeIsVideoBytes(url: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...fetchHeaders(headers), Range: 'bytes=0-2048' },
      // node fetch follows redirects by default
    });
    if (res.status !== 200 && res.status !== 206) return false;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.startsWith('text/html') || ct.startsWith('application/xhtml')) {
      return false;
    }
    // Accept video/*, application/octet-stream, application/vnd.apple.mpegurl,
    // application/x-mpegURL, etc.
    if (
      ct.startsWith('video/') ||
      ct.startsWith('application/octet-stream') ||
      ct.includes('mpegurl') ||
      ct.includes('mp2t')
    ) {
      return true;
    }
    // Unknown content-type — check first bytes for MP4 ISO BMFF signature.
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return true;
    return false;
  } catch {
    return false;
  }
}

async function scrapeEmbedForStream(
  pageUrl: string,
  headers: Record<string, string>,
): Promise<{ url: string; isHls: boolean } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let html = '';
  try {
    const res = await fetch(pageUrl, {
      headers: fetchHeaders(headers),
      signal: ctrl.signal,
    });
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const m3u8 = pickFirstUrl(
    html,
    /https?:\/\/[^"'\s<>\\]+?\/[^"'\s<>\\/]+\.m3u8(?:[?#][^"'\s<>\\]*)?/i,
  );
  if (m3u8) return { url: m3u8.replace(/&amp;/g, '&'), isHls: true };

  const mp4 = pickFirstUrl(
    html,
    /https?:\/\/[^"'\s<>\\]+?\/[^"'\s<>\\/]+\.mp4(?:[?#][^"'\s<>\\]*)?/i,
  );
  if (mp4) return { url: mp4.replace(/&amp;/g, '&'), isHls: false };

  return null;
}

function pickFirstUrl(html: string, re: RegExp): string | null {
  const a = html.match(re);
  if (a) return a[0];
  const b = html.replace(/\\\//g, '/').match(re);
  return b ? b[0] : null;
}

async function captureFromHls(
  playlistUrl: string,
  outputPath: string,
  headers: Record<string, string>,
): Promise<void> {
  let currentUrl = playlistUrl;
  let res = await fetch(currentUrl, { headers: fetchHeaders(headers) });
  if (!res.ok) {
    throw new Error(`Playlist ${res.status} ${res.statusText} (${currentUrl.slice(0, 120)})`);
  }
  let playlist = await res.text();

  // Walk down master → variant playlists (max 2 hops)
  for (let hops = 0; hops < 2 && playlist.includes('#EXT-X-STREAM-INF'); hops++) {
    const variants = parseM3U8Variants(playlist, currentUrl);
    if (variants.length === 0) throw new Error('Master playlist has no variants');
    currentUrl = variants[variants.length - 1]; // pick highest quality (last)
    res = await fetch(currentUrl, { headers: fetchHeaders(headers) });
    if (!res.ok) throw new Error(`Variant ${res.status} (${currentUrl.slice(0, 120)})`);
    playlist = await res.text();
  }

  const segments = parseSegments(playlist, currentUrl);
  if (segments.length === 0) throw new Error('No segments in playlist');

  // Find segment ~5s in
  let target = segments[0];
  let acc = 0;
  for (const seg of segments) {
    if (acc + seg.duration >= 5) {
      target = seg;
      break;
    }
    acc += seg.duration;
  }

  const segRes = await fetch(target.url, { headers: fetchHeaders(headers) });
  if (!segRes.ok) throw new Error(`Segment ${segRes.status} (${target.url.slice(0, 120)})`);
  let bytes = Buffer.from(await segRes.arrayBuffer());
  bytes = stripPngHeader(bytes);

  const dir = path.dirname(outputPath);
  const tmpSeg = path.join(dir, `tmp_${path.basename(outputPath, '.png')}_seg.ts`);
  fs.writeFileSync(tmpSeg, bytes);
  try {
    const seek = target.duration > 2 ? '00:00:02' : '00:00:00';
    // -ss after -i uses slow/accurate seek, which correctly handles segments
    // with non-zero absolute PTS (common in HLS streams from proxy CDNs).
    execSync(`ffmpeg -y -i "${tmpSeg}" -ss ${seek} -frames:v 1 -q:v 2 "${outputPath}"`, {
      stdio: 'pipe',
      timeout: 25000,
    });
  } finally {
    try {
      fs.unlinkSync(tmpSeg);
    } catch {
      /* ignore */
    }
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error(`ffmpeg produced no/empty screenshot at ${outputPath}`);
  }
}

async function captureFromMp4(
  mp4Url: string,
  outputPath: string,
  headers: Record<string, string>,
): Promise<void> {
  // We intentionally don't pre-probe direct URLs: some hosts (notably
  // mp4upload) issue single-use tokens, so a separate Range probe burns the
  // token and leaves ffmpeg with a 403. ffmpeg's HTTP error is informative
  // enough when something goes wrong.

  // ffmpeg's `-headers` blob does NOT reliably override the built-in
  // User-Agent header. The dedicated `-user_agent` and `-referer` flags
  // do — use them for these two, and put any remaining custom headers in
  // `-headers`.
  const ua =
    headers['User-Agent'] ??
    headers['user-agent'] ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const referer = headers.Referer ?? headers.referer ?? '';

  const remaining = Object.entries(headers).filter(([k]) => {
    const lower = k.toLowerCase();
    return lower !== 'user-agent' && lower !== 'referer';
  });
  const headerArg =
    remaining.length > 0
      ? `-headers ${JSON.stringify(remaining.map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n')}`
      : '';

  execSync(
    [
      'ffmpeg -y',
      `-user_agent ${JSON.stringify(ua)}`,
      referer ? `-referer ${JSON.stringify(referer)}` : '',
      headerArg,
      '-ss 00:00:05',
      `-i ${JSON.stringify(mp4Url)}`,
      '-frames:v 1 -q:v 2',
      JSON.stringify(outputPath),
    ]
      .filter(Boolean)
      .join(' '),
    { stdio: 'pipe', timeout: 25000 },
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error(`ffmpeg produced no/empty screenshot at ${outputPath}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ScreenshotResult {
  outputPath: string;
  stream: IVideoPayload;
  attemptedCount: number;
}

/**
 * Capture a screenshot ~5 seconds into a stream. When given an array of
 * candidates, walks them in order and returns the first successful capture.
 *
 * The output PNG must be at least 1KB; otherwise the attempt is rejected so
 * the next candidate gets a chance.
 */
export async function captureStreamScreenshot(
  providerId: string,
  streams: IVideoPayload | IVideoPayload[],
): Promise<ScreenshotResult> {
  const list = Array.isArray(streams) ? streams : [streams];
  if (list.length === 0) throw new Error('captureStreamScreenshot: streams array is empty');

  const localDir = path.resolve(process.cwd(), 'scratch/screenshots');
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

  const outputPath = path.join(localDir, `screenshot_${providerId}.png`);
  // Clear any stale screenshot from a previous run.
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
  }

  const errors: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    console.log(
      `[Screenshot ${providerId}] Attempt ${i + 1}/${list.length}: ` +
        `${candidate.isHLS ? 'HLS' : 'direct'} ${candidate.sourceUrl.slice(0, 120)}`,
    );
    try {
      await captureFromUrl(outputPath, candidate);
      console.log(`[Screenshot ${providerId}] OK → ${outputPath}`);
      return { outputPath, stream: candidate, attemptedCount: i + 1 };
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`[Screenshot ${providerId}]   failed: ${msg}`);
      errors.push(`#${i + 1} (${candidate.sourceUrl.slice(0, 60)}…): ${msg}`);
    }
  }

  throw new Error(
    `captureStreamScreenshot(${providerId}) exhausted all ${list.length} candidate(s).\n` +
      errors.map((e) => `  - ${e}`).join('\n'),
  );
}
