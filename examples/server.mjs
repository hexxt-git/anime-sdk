import { startServer, createSdk } from '../dist/index.js';

const sdk = createSdk({
  http: { timeoutMs: 30000 },
});

startServer({ port: Number(process.env.PORT ?? 3030), sdk });
