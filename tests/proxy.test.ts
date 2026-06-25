import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { proxifyStream, proxifyPages, buildProxyUrl } from '../src/server/proxy.js';
import type { Stream, Pages } from '../src/types.js';

const BASE = 'http://localhost:3030';

function sign(secret: string, url: string, h?: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(url);
  if (h) hmac.update('|h=' + h);
  return hmac.digest('hex');
}

describe('buildProxyUrl', () => {
  it('encodes the target url', () => {
    const u = buildProxyUrl(BASE, 'https://cdn/file?x=1', undefined, undefined);
    expect(u).toBe(`${BASE}/proxy?url=${encodeURIComponent('https://cdn/file?x=1')}`);
  });

  it('appends a signature when a secret is supplied', () => {
    const target = 'https://cdn/file.m3u8';
    const u = buildProxyUrl(BASE, target, undefined, 'shh');
    const sig = sign('shh', target);
    expect(u).toContain(`&sig=${sig}`);
  });

  it('signs the headers payload when present', () => {
    const target = 'https://cdn/file.m3u8';
    const h = Buffer.from(JSON.stringify({ Referer: 'https://x' })).toString('base64');
    const u = buildProxyUrl(BASE, target, h, 'shh');
    const sig = sign('shh', target, h);
    expect(u).toContain(`&h=${encodeURIComponent(h)}`);
    expect(u).toContain(`&sig=${sig}`);
  });
});

describe('proxifyStream', () => {
  it('rewrites url, qualities, and subtitles to go through /proxy', () => {
    const stream: Stream = {
      url: 'https://cdn/ep1.m3u8',
      origin: { host: 'cdn', url: 'https://cdn/ep1.m3u8', proxied: false },
      isHls: true,
      qualities: [
        { label: '1080p', url: 'https://cdn/ep1-1080.m3u8' },
        { label: '720p', url: 'https://cdn/ep1-720.m3u8' },
      ],
      language: 'sub',
      subtitles: [{ url: 'https://subs/en.vtt', language: 'en', label: 'English', format: 'vtt' }],
      headers: { Referer: 'https://prov.com/' },
      adjacent: {},
    };

    const out = proxifyStream(stream, BASE, undefined);
    expect(out.url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.qualities[0].url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.qualities[1].url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.subtitles[0].url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.subtitles[0].url).toContain('ct=text%2Fvtt');
    expect(out.origin.proxied).toBe(true);
    expect(out.origin.host).toBe('cdn'); // origin host preserved
  });

  it('encodes the headers payload into every URL', () => {
    const stream: Stream = {
      url: 'https://cdn/ep1.m3u8',
      origin: { host: 'cdn', url: 'https://cdn/ep1.m3u8', proxied: false },
      isHls: true,
      qualities: [],
      language: 'sub',
      subtitles: [],
      headers: { Referer: 'https://prov.com/' },
      adjacent: {},
    };

    const out = proxifyStream(stream, BASE, undefined);
    expect(out.url).toContain('h=');
    const h = new URL(out.url).searchParams.get('h')!;
    const decoded = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    expect(decoded.Referer).toBe('https://prov.com/');
  });
});

describe('proxifyPages', () => {
  it('rewrites every page URL', () => {
    const pages: Pages = {
      pages: [
        { url: 'https://img/1.jpg', origin: { host: 'img' } },
        { url: 'https://img/2.jpg', origin: { host: 'img' } },
      ],
      adjacent: {},
    };
    const out = proxifyPages(pages, BASE, undefined);
    expect(out.pages[0].url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.pages[1].url.startsWith(`${BASE}/proxy?url=`)).toBe(true);
    expect(out.pages[0].origin.host).toBe('img'); // origin preserved
  });
});
