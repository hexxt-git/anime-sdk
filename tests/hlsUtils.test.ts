import { describe, it, expect } from 'vitest';
import { HttpClient } from '../src/internal/http.js';
import { HlsUtils } from '../src/internal/hls.js';

describe('HlsUtils', () => {
  it('should return unmodified manifest when no proxy is configured', () => {
    const client = new HttpClient();
    const manifest = `
#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment1.ts
    `.trim();
    const result = HlsUtils.rewriteManifest(manifest, 'https://example.com/playlist.m3u8', client);
    expect(result).toBe(manifest);
  });

  it('should rewrite relative and absolute chunk URLs through a path-prepend proxy', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com',
      proxyType: 'prepend',
    });
    const manifest = `
#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
http://absolute.com/chunk-01.ts
#EXTINF:10.0,
chunk-02.ts
#EXTINF:10.0,
/chunk-03.ts
    `.trim();

    const result = HlsUtils.rewriteManifest(
      manifest,
      'https://example.com/stream/playlist.m3u8',
      client,
    );

    const expected = `
#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
https://myproxy.com/absolute.com/chunk-01.ts
#EXTINF:10.0,
https://myproxy.com/example.com/stream/chunk-02.ts
#EXTINF:10.0,
https://myproxy.com/example.com/chunk-03.ts
    `.trim();

    expect(result).toBe(expected);
  });

  it('should rewrite AES-128 key URIs correctly', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com',
      proxyType: 'prepend',
    });
    const manifest = `
#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
#EXT-X-KEY:METHOD=AES-128,URI="https://absolute-key.com/key.key"
#EXTINF:10.0,
segment.ts
    `.trim();

    const result = HlsUtils.rewriteManifest(manifest, 'https://example.com/playlist.m3u8', client);

    const expected = `
#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://myproxy.com/example.com/key.key"
#EXT-X-KEY:METHOD=AES-128,URI="https://myproxy.com/absolute-key.com/key.key"
#EXTINF:10.0,
https://myproxy.com/example.com/segment.ts
    `.trim();

    expect(result).toBe(expected);
  });
});
