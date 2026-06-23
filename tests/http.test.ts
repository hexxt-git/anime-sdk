import { describe, it, expect } from 'vitest';
import { HttpClient } from '../src/internal/http.js';

describe('HttpClient', () => {
  it('should return original URL when no proxy is configured', () => {
    const client = new HttpClient();
    const url = 'https://example.com/api/v1/media';
    expect(client.requestUrl(url)).toBe(url);
  });

  it('should format URL correctly with path-prepending proxy', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com',
      proxyType: 'prepend',
    });
    const url = 'https://example.com/api/v1/media';
    expect(client.requestUrl(url)).toBe('https://myproxy.com/example.com/api/v1/media');
  });

  it('should format URL correctly with path-prepending proxy ending in slash', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com/',
      proxyType: 'prepend',
    });
    const url = 'https://example.com/api/v1/media';
    expect(client.requestUrl(url)).toBe('https://myproxy.com/example.com/api/v1/media');
  });

  it('should format URL correctly with query-parameter proxy', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com/bypass',
      proxyType: 'query',
      proxyQueryParam: 'target',
    });
    const url = 'https://example.com/api/v1/media';
    expect(client.requestUrl(url)).toBe(
      'https://myproxy.com/bypass?target=https%3A%2F%2Fexample.com%2Fapi%2Fv1%2Fmedia',
    );
  });

  it('should format URL correctly with query-parameter proxy containing existing query params', () => {
    const client = new HttpClient({
      proxyUrl: 'https://myproxy.com/bypass?key=123',
      proxyType: 'query',
    });
    const url = 'https://example.com/api/v1/media';
    expect(client.requestUrl(url)).toBe(
      'https://myproxy.com/bypass?key=123&url=https%3A%2F%2Fexample.com%2Fapi%2Fv1%2Fmedia',
    );
  });

  it('should set User-Agent header correctly', () => {
    const client = new HttpClient();
    client.setUserAgent('Custom-Agent/1.0');
    expect(client.getDefaultHeaders()['User-Agent']).toBe('Custom-Agent/1.0');
  });

  it('should inject cookie headers correctly', () => {
    const client = new HttpClient();
    client.setCookie('cf_clearance', 'token123');
    expect(client.getDefaultHeaders()['Cookie']).toBe('cf_clearance=token123');

    // Add another cookie
    client.setCookie('foo', 'bar');
    expect(client.getDefaultHeaders()['Cookie']).toBe('cf_clearance=token123; foo=bar');

    // Update existing cookie
    client.setCookie('cf_clearance', 'token456');
    expect(client.getDefaultHeaders()['Cookie']).toBe('foo=bar; cf_clearance=token456');
  });
});
