export const AniErrorCode = {
  SourceUnavailable: 'SourceUnavailable',
  NoStream: 'NoStream',
  RegionBlocked: 'RegionBlocked',
  RateLimited: 'RateLimited',
  NotFound: 'NotFound',
  Cancelled: 'Cancelled',
  BadId: 'BadId',
} as const;

export type AniErrorCode = (typeof AniErrorCode)[keyof typeof AniErrorCode];

export class AniError extends Error {
  readonly code: AniErrorCode;
  readonly source?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(opts: {
    code: AniErrorCode;
    message: string;
    source?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'AniError';
    this.code = opts.code;
    this.source = opts.source;
    this.retryable = opts.retryable ?? false;
    this.cause = opts.cause;
  }
}
