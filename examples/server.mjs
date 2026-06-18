import {
  HttpClient,
  startServer,
  GogoanimeProvider,
  GoyabuProvider,
  AllmangaProvider,
  AnimeParadiseProvider,
  AnikotoProvider,
  MegaPlayProvider,
  MangadexProvider,
  WeebcentralProvider,
  MangapillProvider,
  AnilistMeta,
  MalMeta,
  KitsuMeta,
  MappingClient,
} from '../dist/index.js';

const http = new HttpClient({ timeoutMs: 30000 });
const mapping = new MappingClient(http);

const store = new Map();
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
};

startServer({
  providers: [
    new GogoanimeProvider(http),
    new GoyabuProvider(http),
    new AllmangaProvider(http),
    new AnimeParadiseProvider(http),
    new AnikotoProvider(http),
    new MegaPlayProvider(http),
    new MangadexProvider(http),
    new WeebcentralProvider(http),
    new MangapillProvider(http),
  ],
  metaProviders: [
    new AnilistMeta(http, { mappingClient: mapping }),
    new MalMeta(http, { mappingClient: mapping }),
    new KitsuMeta(http, { mappingClient: mapping }),
  ],
  port: Number(process.env.PORT ?? 3030),
  proxy: true,
  cache,
});
