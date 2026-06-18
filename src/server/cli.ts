#!/usr/bin/env node
import { startServerV2 } from './index.js';
import { createSdk } from '../sdk.js';
import type { SdkOptions } from '../config.js';

function parseEnv(): { port: number; sdkOpts: SdkOptions } {
  const port = Number(process.env.PORT ?? 3030);
  const disabled = process.env.SOURCES_DISABLED
    ? process.env.SOURCES_DISABLED.split(',').map((s) => s.trim())
    : undefined;
  return {
    port,
    sdkOpts: { disabled },
  };
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    [
      'anime-sdk server',
      '',
      'Usage: npx anime-sdk [options]',
      '',
      'Env:',
      '  PORT=3030            Port to listen on',
      '  SOURCES_DISABLED=x   Comma-separated source IDs to disable',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const { port, sdkOpts } = parseEnv();
const sdk = createSdk(sdkOpts);
const server = startServerV2({ port, sdk });

server.on('listening', () => {
  const addr = server.address();
  const p = addr && typeof addr !== 'string' ? addr.port : port;
  process.stderr.write(`anime-sdk listening on http://localhost:${p}\n`);
});

server.on('error', (err) => {
  process.stderr.write(`anime-sdk server error: ${err.message}\n`);
  process.exit(1);
});
