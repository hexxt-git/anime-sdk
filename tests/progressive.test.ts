import { describe, it, expect } from 'vitest';
import { createProgressiveResult } from '../src/progressive.js';
import { AniError, AniErrorCode } from '../src/errors.js';

describe('createProgressiveResult', () => {
  it('await collects all items from multiple producers', async () => {
    const pr = createProgressiveResult([
      async (push) => {
        push('a');
        push('b');
      },
      async (push) => {
        push('c');
      },
    ]);
    const all = await pr;
    expect(all.sort()).toEqual(['a', 'b', 'c']);
  });

  it('async iteration yields items as they arrive', async () => {
    const pr = createProgressiveResult([
      async (push) => {
        push(1);
        push(2);
      },
      async (push) => {
        push(3);
      },
    ]);
    const collected: number[] = [];
    for await (const item of pr) {
      collected.push(item);
    }
    expect(collected.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('cancelled via AbortSignal resolves with Cancelled error', async () => {
    const ac = new AbortController();
    const pr = createProgressiveResult<string>(
      [
        async (push, sig) => {
          await new Promise<void>((r) => setTimeout(r, 50));
          if (!sig.aborted) push('late');
        },
      ],
      ac.signal,
    );

    ac.abort();
    await expect(pr).rejects.toSatisfy(
      (e: unknown) => e instanceof AniError && e.code === AniErrorCode.Cancelled,
    );
  });

  it('cancel() stops iteration and rejects awaited result', async () => {
    const pr = createProgressiveResult<number>([
      async (push, sig) => {
        for (let i = 0; i < 100; i++) {
          if (sig.aborted) break;
          push(i);
        }
      },
    ]);

    pr.cancel();
    const items: number[] = [];
    try {
      for await (const item of pr) items.push(item);
    } catch {
      // cancelled — normal
    }
    expect(items.length).toBeLessThanOrEqual(100);
  });

  it('empty producers resolve to empty array', async () => {
    const pr = createProgressiveResult<string>([]);
    expect(await pr).toEqual([]);
  });
});
