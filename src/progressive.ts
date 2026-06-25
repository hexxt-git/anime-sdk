import { AniError, AniErrorCode } from './errors.js';

export interface ProgressiveResult<T> extends AsyncIterable<T>, PromiseLike<T[]> {
  cancel(): void;
}

type Producer<T> = (push: (item: T) => void, signal: AbortSignal) => Promise<void>;

export function createProgressiveResult<T>(
  producers: Producer<T>[],
  signal?: AbortSignal,
): ProgressiveResult<T> {
  const ac = new AbortController();
  const combined = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;

  const queue: T[] = [];
  let done = false;
  let producerError: unknown;
  const waiters: Array<() => void> = [];

  function push(item: T): void {
    if (combined.aborted) return;
    queue.push(item);
    waiters.shift()?.();
  }

  function wake(): void {
    waiters.shift()?.();
  }

  const allDone = Promise.all(
    producers.map((p) =>
      p(push, combined).catch((e) => {
        if (!combined.aborted) producerError = e;
      }),
    ),
  ).finally(() => {
    done = true;
    wake();
  });

  const collectAll = (): Promise<T[]> =>
    allDone.then(() => {
      if (combined.aborted && signal?.aborted) {
        return Promise.reject(
          new AniError({ code: AniErrorCode.Cancelled, message: 'Search cancelled' }),
        );
      }
      if (producerError) return Promise.reject(producerError);
      return [...queue];
    });

  const result: ProgressiveResult<T> = {
    cancel() {
      ac.abort();
      wake();
    },

    then<R1 = T[], R2 = never>(
      onfulfilled?: ((v: T[]) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
    ): Promise<R1 | R2> {
      return collectAll().then(onfulfilled, onrejected);
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          while (true) {
            if (index < queue.length) {
              return { value: queue[index++], done: false };
            }
            if (done || combined.aborted) {
              if (combined.aborted && signal?.aborted) {
                throw new AniError({
                  code: AniErrorCode.Cancelled,
                  message: 'Search cancelled',
                });
              }
              return { value: undefined as T, done: true };
            }
            await new Promise<void>((r) => waiters.push(r));
          }
        },
      };
    },
  };

  return result;
}
