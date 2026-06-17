/**
 * Live test: BaseProvider.maxConcurrency caps in-flight calls.
 *
 * Uses a real http.Server upstream that records the number of overlapping
 * requests in flight at any moment, then drives the provider with a burst
 * of parallel calls. Asserts the upstream never sees more than the cap.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { BaseProvider, CallOptions } from '../../src/providers/BaseProvider.js';
import { HttpClient } from '../../src/transport/http.js';
import {
  ContentLanguage,
  IContentUnit,
  IMediaSearchResult,
  MediaCatalogType,
  ResolvedMediaStream,
} from '../../src/types/index.js';

let server: http.Server;
let baseUrl: string;
let inFlight = 0;
let maxInFlight = 0;
const reset = () => {
  inFlight = 0;
  maxInFlight = 0;
};

beforeAll(async () => {
  server = http.createServer(async (_req, res) => {
    inFlight += 1;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    // hold the connection long enough for parallel requests to overlap
    await new Promise<void>((r) => setTimeout(r, 60));
    inFlight -= 1;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

class CappedProvider extends BaseProvider {
  public readonly id = 'capped';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  public readonly maxConcurrency = 2;
  protected async searchRaw(_q: string, options: CallOptions = {}): Promise<IMediaSearchResult[]> {
    await this.http.get(`${baseUrl}/q`, { signal: options.signal });
    return [{ id: 'x', title: 'x', catalogType: 'ANIME', providerId: this.id }];
  }
  protected async fetchContentUnitsRaw(): Promise<IContentUnit[]> {
    return [];
  }
  protected async resolveStreamRaw(_u: string, _l?: ContentLanguage): Promise<ResolvedMediaStream> {
    throw new Error('not implemented');
  }
}

describe('BaseProvider — concurrency cap', () => {
  it('caps parallel in-flight calls to maxConcurrency', async () => {
    reset();
    const http = new HttpClient({ disableRateLimit: true, retry: false });
    const provider = new CappedProvider(http);
    // 10 parallel calls; only 2 should hit the upstream simultaneously.
    await Promise.all(Array.from({ length: 10 }, () => provider.search('q')));
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(0);
  }, 30_000);
});
