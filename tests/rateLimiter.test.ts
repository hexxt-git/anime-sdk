import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/transport/rateLimiter.js';

describe('RateLimiter', () => {
  it('acquires immediately when under capacity', async () => {
    const r = new RateLimiter({ 'example.com': { capacity: 3, intervalMs: 60_000 } });
    const before = Date.now();
    await r.acquire('example.com');
    await r.acquire('example.com');
    await r.acquire('example.com');
    expect(Date.now() - before).toBeLessThan(50);
    expect(r.snapshot('example.com')).toMatchObject({ tokens: 0, queued: 0 });
  });

  it('queues callers past capacity until the next window', async () => {
    const r = new RateLimiter({ 'example.com': { capacity: 1, intervalMs: 200 } });
    const start = Date.now();
    await r.acquire('example.com');
    const p = r.acquire('example.com');
    await p;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(600);
  });

  it('honours both base + burst windows', async () => {
    const r = new RateLimiter({
      'example.com': {
        capacity: 10,
        intervalMs: 60_000,
        burst: { capacity: 2, intervalMs: 200 },
      },
    });
    await r.acquire('example.com');
    await r.acquire('example.com');
    const start = Date.now();
    await r.acquire('example.com'); // queued behind the burst window
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('respects abort signal while queued', async () => {
    const r = new RateLimiter({ 'example.com': { capacity: 1, intervalMs: 10_000 } });
    await r.acquire('example.com'); // exhaust the bucket
    const ac = new AbortController();
    const p = r.acquire('example.com', ac.signal);
    queueMicrotask(() => ac.abort());
    await expect(p).rejects.toThrow();
    // After abort, snapshot should show the queue draining.
    expect(r.snapshot('example.com')?.queued).toBe(0);
  });

  it('returns null snapshot for unknown hosts', () => {
    const r = new RateLimiter({});
    expect(r.snapshot('nobody.example')).toBeNull();
  });

  it('does not throttle hosts without a policy', async () => {
    const r = new RateLimiter({});
    const before = Date.now();
    for (let i = 0; i < 1_000; i++) await r.acquire('unbounded.example');
    expect(Date.now() - before).toBeLessThan(100);
  });
});
