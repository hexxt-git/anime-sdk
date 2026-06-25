import { createSdk } from '../dist/index.js';

const sdk = createSdk({
  http: { timeoutMs: 30000 },
});

const results = await sdk.search('Frieren', { kind: 'anime' });

console.log({ results: results.slice(0, 3) }, '\n\n');

const { items: episodes } = await sdk.episodes(results[0]);

console.log({ episodes: episodes.slice(0, 3) }, '\n\n');

const stream = await sdk.stream(episodes[0], { language: 'sub' });

console.log({ stream });
