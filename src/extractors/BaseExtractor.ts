import { HttpClient } from '../internal/http.js';
import { IVideoPayload } from '../types/index.js';

export abstract class BaseExtractor {
  abstract readonly id: string;
  constructor(protected http: HttpClient) {}
  abstract extract(embedUrl: string): Promise<IVideoPayload[]>;
}
