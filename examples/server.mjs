import { startServerV2, createSdk } from '../dist/index.js';

const sdk = createSdk({
  http: { timeoutMs: 30000 },
});

startServerV2({ port: Number(process.env.PORT ?? 3030), sdk });
