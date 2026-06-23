export interface SdkOptions {
  sources?: string[];
  disabled?: string[];
  http?: {
    timeoutMs?: number;
    retries?: number;
    userAgent?: string;
  };
}

const DEFAULTS: Required<Pick<SdkOptions, 'http'>> = {
  http: {
    timeoutMs: 30000,
    retries: 3,
  },
};

export function resolveOptions(
  opts?: SdkOptions,
): SdkOptions & { http: NonNullable<SdkOptions['http']> } {
  return {
    ...opts,
    http: { ...DEFAULTS.http, ...opts?.http },
  };
}
