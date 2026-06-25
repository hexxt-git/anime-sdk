import { createSdk } from '../dist/index.js';

const sdk = createSdk({
  http: { timeoutMs: 30000 },
});

const results = await sdk.search('Berserk', { kind: 'anime' });

console.log({ results: results.slice(0, 3) });
console.log(results[0]);
console.log('\n\n');

const { items: episodes } = await sdk.episodes(results[0]);

console.log({ episodes: episodes.slice(0, 3) });
console.log(episodes[0]);
console.log('\n\n');

const streams = await sdk.stream(episodes[0]);

console.dir({ streams }, { depth: 100 });
console.log('\n\n');
