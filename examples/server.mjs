import { startServer, createSdk } from '../dist/index.js';

const port = Number(process.env.PORT ?? 3030);

const sdk = createSdk({
  http: { timeoutMs: 30000 },
});

// Proxy is enabled by default so the example frontend can play streams
// from CDNs that gate on `Referer` (megaplay, wix, googlevideo, …).
// Set PROXY_SIGN_SECRET in production; PROXY_ALLOWED_HOSTS is a
// suffix-matched SSRF allowlist (e.g. "wixstatic.com,megacdn.co").
const allowedHosts = process.env.PROXY_ALLOWED_HOSTS
  ? process.env.PROXY_ALLOWED_HOSTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined;

startServer({
  port,
  sdk,
  proxy: {
    signSecret: process.env.PROXY_SIGN_SECRET,
    allowedHosts,
  },
});

console.log(`anime-sdk example server listening on http://localhost:${port}`);
