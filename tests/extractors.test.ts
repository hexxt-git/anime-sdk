import { describe, it, expect, vi } from 'vitest';
import { aesEncrypt, aesDecrypt } from '../src/utils/crypto.js';
import { HttpClient } from '../src/internal/http.js';
import { VidstreamingExtractor } from '../src/extractors/VidstreamingExtractor.js';

describe('AES Cryptography Helpers', () => {
  it('should encrypt and decrypt plaintext correctly', async () => {
    const key = '1234567890123456';
    const iv = '6543210987654321';
    const plaintext = 'id=123&alias=test-alias';

    const encrypted = await aesEncrypt(plaintext, key, iv);
    expect(encrypted).not.toBe(plaintext);

    const decrypted = await aesDecrypt(encrypted, key, iv);
    expect(decrypted).toBe(plaintext);
  });
});

describe('VidstreamingExtractor', () => {
  it('should extract streams from a mocked Vidstreaming page', async () => {
    const http = new HttpClient();
    const extractor = new VidstreamingExtractor(http);

    const key = '1234567890123456';
    const iv = '6543210987654321';
    const decKey = '1111222233334444';

    // Mock HTML content that simulates GogoPlay's iframe elements
    const mockHtml = `
      <html>
        <body>
          <div class="container-${key}"></div>
          <div class="videocontent-${iv}"></div>
          <div class="container-${decKey}"></div>
          <script data-name="episode" data-value="MOCKED_DATA_VALUE"></script>
        </body>
      </html>
    `;

    // 1. Encrypted payload inside data-value
    const decryptedPayload = 'id=43918&token=xyz';
    const encryptedDataValue = await aesEncrypt(decryptedPayload, key, iv);
    const htmlWithData = mockHtml.replace('MOCKED_DATA_VALUE', encryptedDataValue);

    // 2. Encrypted response from encrypt-ajax.php
    const mockAjaxResult = {
      source: [
        { file: 'https://cdn.com/stream.m3u8', label: '1080 P' },
        { file: 'https://cdn.com/stream-720.m3u8', label: '720 P' },
      ],
      source_bk: [],
    };
    const encryptedAjaxData = await aesEncrypt(JSON.stringify(mockAjaxResult), decKey, iv);

    // Mock HttpClient calls
    const mockGet = vi.spyOn(http, 'get');
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('encrypt-ajax.php')) {
        return {
          status: 200,
          json: async () => ({ data: encryptedAjaxData }),
        } as Response;
      }
      return {
        status: 200,
        text: async () => htmlWithData,
      } as Response;
    });

    const embedUrl = 'https://ajax.gogo-load.com/embed.html?id=NDM5MTg=&token=foo';
    const streams = await extractor.extract(embedUrl);

    expect(streams).toHaveLength(2);
    expect(streams[0].sourceUrl).toBe('https://cdn.com/stream.m3u8');
    expect(streams[0].isHLS).toBe(true);
    expect(streams[0].quality).toBe('1080p');
    expect(streams[1].quality).toBe('720p');
    expect(streams[0].headers?.Referer).toBe(embedUrl);
  });
});
