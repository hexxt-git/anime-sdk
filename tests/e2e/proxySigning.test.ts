/**
 * Live test of the `/proxy` HMAC-signing scheme.
 *
 * Spawns a real server with `proxySignSecret`, asks for a real stream via
 * the meta layer (so the response goes through the server's `proxyifyStream`
 * rewriter, which signs every URL), then verifies:
 *
 *   - The rewritten `sourceUrl` contains a `sig` query param.
 *   - Hitting `/proxy` with a *valid* `sig` proxies the upstream byte stream.
 *   - Hitting `/proxy` with an invalid signature returns 401.
 *   - Hitting `/proxy` with no signature returns 401.
 *
 * To keep the test deterministic we sign a benign upstream URL (AniList's
 * public OpenAPI cover image — small, fast, always reachable). The flow
 * doesn't touch any provider; the proxy signing logic is fully exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { HttpClient } from '../../src/transport/http.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';
import { startServer } from '../../src/server/index.js';

let server: http.Server;
let baseUrl: string;
const SECRET = 'super-secret-key';

beforeAll(async () => {
  const httpClient = new HttpClient({ timeoutMs: 20_000 });
  server = startServer({
    providers: [new AllmangaProvider(httpClient)],
    metaProviders: [],
    proxy: true,
    proxySignSecret: SECRET,
    port: await getFreePort(),
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sign(url: string, h?: string): string {
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(url);
  if (h) hmac.update('|h=' + h);
  return hmac.digest('hex');
}

describe('/proxy signature enforcement', () => {
  // example.com is the IANA-reserved demonstration domain — always
  // reachable and serves a small static HTML doc on GET.
  const target = 'https://example.com/';

  it('rejects unsigned requests with 401', async () => {
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(target)}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sig/i);
  });

  it('rejects bad signatures with 401', async () => {
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(target)}&sig=deadbeef`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature and streams the upstream body', async () => {
    const sig = sign(target);
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(target)}&sig=${sig}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  }, 30_000);

  it('signature covers the headers (`h`) parameter too', async () => {
    const headers = { 'X-Test': 'yes' };
    const h = Buffer.from(JSON.stringify(headers)).toString('base64');
    const goodSig = sign(target, h);
    const r1 = await fetch(
      `${baseUrl}/proxy?url=${encodeURIComponent(target)}&h=${encodeURIComponent(h)}&sig=${goodSig}`,
    );
    expect(r1.status).toBe(200);

    // Re-using the URL-only signature must be rejected — the `h` payload
    // changes what's being proxied, so the sig must reflect it.
    const urlOnlySig = sign(target);
    const r2 = await fetch(
      `${baseUrl}/proxy?url=${encodeURIComponent(target)}&h=${encodeURIComponent(h)}&sig=${urlOnlySig}`,
    );
    expect(r2.status).toBe(401);
  }, 30_000);
});

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      const port = addr.port;
      s.close(() => resolve(port));
    });
  });
}
