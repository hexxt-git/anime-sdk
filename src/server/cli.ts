#!/usr/bin/env node
import { startServer, ServerOptions } from './index.js';
import { createSdk } from '../sdk.js';
import type { SdkOptions } from '../config.js';

function parseEnv(): { port: number; sdkOpts: SdkOptions; serverOpts: ServerOptions } {
  const port = Number(process.env.PORT ?? 3030);
  const disabled = process.env.SOURCES_DISABLED
    ? process.env.SOURCES_DISABLED.split(',').map((s) => s.trim())
    : undefined;

  // Proxy enables when any PROXY_* env var is set, or when the user explicitly
  // opts in with PROXY=1.
  const proxyEnabled =
    process.env.PROXY === '1' ||
    process.env.PROXY === 'true' ||
    !!process.env.PROXY_SIGN_SECRET ||
    !!process.env.PROXY_ALLOWED_HOSTS ||
    !!process.env.PROXY_BASE;

  const serverOpts: ServerOptions = { port };
  if (proxyEnabled) {
    serverOpts.proxy = {
      base: process.env.PROXY_BASE,
      signSecret: process.env.PROXY_SIGN_SECRET,
      allowedHosts: process.env.PROXY_ALLOWED_HOSTS
        ? process.env.PROXY_ALLOWED_HOSTS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    };
  }

  return { port, sdkOpts: { disabled }, serverOpts };
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    [
      'anime-sdk server',
      '',
      'Usage: npx anime-sdk [options]',
      '',
      'Env:',
      '  PORT=3030               Port to listen on',
      '  SOURCES_DISABLED=x,y    Comma-separated source IDs to disable',
      '  PROXY=1                 Enable /proxy + Stream URL rewriting',
      '  PROXY_BASE=https://...  Public base URL (defaults to Host header)',
      '  PROXY_SIGN_SECRET=x     HMAC-sign upstream URLs (recommended in prod)',
      '  PROXY_ALLOWED_HOSTS=a,b SSRF allowlist (suffix-matched hostnames)',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const { port, sdkOpts, serverOpts } = parseEnv();
const sdk = createSdk(sdkOpts);
const server = startServer({ ...serverOpts, sdk });

server.on('listening', () => {
  const addr = server.address();
  const p = addr && typeof addr !== 'string' ? addr.port : port;
  process.stderr.write(`anime-sdk listening on http://localhost:${p}\n`);
});

server.on('error', (err) => {
  process.stderr.write(`anime-sdk server error: ${err.message}\n`);
  process.exit(1);
});
