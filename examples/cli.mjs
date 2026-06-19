import { createInterface } from 'node:readline/promises';
import { stdin } from 'node:process';
import { createSdk } from '../dist/index.js';

const io = createInterface({ input: stdin, output: process.stdout });
const sdk = createSdk();

async function pick(items, label) {
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  const n = Number(await io.question(`\n${label}: `)) - 1;
  return n;
}

console.log('\n═══ anime-sdk CLI ═══\n');

const kind = (await io.question('Kind (anime/manga) [anime]: ')).trim() || 'anime';
const query = await io.question('Search: ');
process.stdout.write('...\n');

const results = await sdk.search(query, { kind });
if (!results.length) {
  console.log('No results.');
  process.exit(0);
}

console.log('');
const ri = await pick(
  results.map((r) => `${r.title.preferred}  [${r.kind}]`),
  'Select title',
);
const media = results[ri];

process.stdout.write('...\n');

if (kind === 'manga') {
  const { items: chapters } = await sdk.chapters(media);
  if (!chapters.length) {
    console.log('No chapters.');
    process.exit(0);
  }

  console.log('');
  const ci = await pick(
    chapters.map((c) => `Ch.${String(c.number).padStart(3, '0')}  ${c.title ?? ''}`),
    'Select chapter',
  );
  const chapter = chapters[ci];
  process.stdout.write('...\n');
  const pages = await sdk.pages(chapter);
  console.log(`\n─── PAGES (${pages.pages.length}) ───`);
  pages.pages.slice(0, 3).forEach((p) => console.log(p.url));
  if (pages.pages.length > 3) console.log(`... (${pages.pages.length - 3} more)`);
} else {
  const { items: episodes } = await sdk.episodes(media);
  if (!episodes.length) {
    console.log('No episodes.');
    process.exit(0);
  }

  console.log('');
  const ei = await pick(
    episodes.map(
      (e) =>
        `EP.${String(e.number).padStart(3, '0')}  ${e.title ?? ''}  (${e.languages.join('/')})`,
    ),
    'Select episode',
  );
  const episode = episodes[ei];
  const lang = episode.languages[0] ?? 'sub';
  process.stdout.write('...\n');
  const stream = await sdk.stream(episode, { language: lang });

  console.log('\n─── STREAM ───');
  console.log(
    `[${stream.isHls ? 'HLS' : 'MP4'}] ${stream.language}  origin: ${stream.origin.host}`,
  );
  console.log(stream.url);
  if (stream.qualities.length > 1) {
    console.log('qualities:', stream.qualities.map((q) => q.label).join(', '));
  }
  if (stream.adjacent.next) {
    console.log(`next: EP.${stream.adjacent.next.number}`);
  }
}

io.close();
