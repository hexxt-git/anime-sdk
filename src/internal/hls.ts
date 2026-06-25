import { HttpClient } from './http.js';

export class HlsUtils {
  /**
   * Rewrites chunk and sub-playlist URLs in an M3U8 playlist to route through the proxy.
   * @param manifestText Raw M3U8 content
   * @param playlistUrl Original URL of the M3U8 file (used to resolve relative paths)
   * @param httpClient HttpClient instance to obtain proxy configuration
   */
  public static rewriteManifest(
    manifestText: string,
    playlistUrl: string,
    httpClient: HttpClient,
  ): string {
    if (!httpClient.getProxyUrl()) {
      return manifestText;
    }

    const lines = manifestText.split(/\r?\n/);
    const rewrittenLines = lines.map((line) => {
      const trimmed = line.trim();
      // Parse URI="..." in tags like #EXT-X-KEY or #EXT-X-MAP
      if (trimmed.startsWith('#')) {
        return this.rewriteTagsWithUris(trimmed, playlistUrl, httpClient);
      }
      if (trimmed.length === 0) {
        return line;
      }
      // This is a URI line (either a chunk or a sub-playlist)
      const absoluteUrl = this.resolveUrl(playlistUrl, trimmed);
      return httpClient.requestUrl(absoluteUrl);
    });

    return rewrittenLines.join('\n');
  }

  /**
   * Resolves relative URLs against a base URL
   */
  private static resolveUrl(base: string, relative: string): string {
    try {
      return new URL(relative, base).href;
    } catch {
      if (relative.startsWith('http://') || relative.startsWith('https://')) {
        return relative;
      }
      const lastSlash = base.lastIndexOf('/');
      if (lastSlash === -1) return relative;
      const basePath = base.substring(0, lastSlash + 1);
      return `${basePath}${relative}`;
    }
  }

  /**
   * Helper to rewrite inline URIs in tags like #EXT-X-KEY:METHOD=AES-128,URI="key.key"
   */
  private static rewriteTagsWithUris(
    line: string,
    playlistUrl: string,
    httpClient: HttpClient,
  ): string {
    // Matches URI="value" or URI='value'
    const uriRegex = /URI=(["'])(.*?)\1/g;
    return line.replace(uriRegex, (match, quote, uri) => {
      const absoluteUrl = this.resolveUrl(playlistUrl, uri);
      const proxiedUrl = httpClient.requestUrl(absoluteUrl);
      return `URI=${quote}${proxiedUrl}${quote}`;
    });
  }
}
