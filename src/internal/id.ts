import { AniError, AniErrorCode } from '../errors.js';

// ─── Opaque ID encode/decode ──────────────────────────────────────────────────
//
// Media/Episode/Chapter ids are base64url-encoded JSON tokens that carry the
// source lineage the SDK needs to dispatch follow-up calls. Format version 1:
//   { v: 1, t: 'media'|'episode'|'chapter', s: sourceId, r: rawId, m?: mappings }

export interface IdPayload {
  v: 1;
  t: 'media' | 'episode' | 'chapter';
  s: string;
  r: string;
  m?: Record<string, unknown>;
}

export function encodeId(payload: Omit<IdPayload, 'v'>): string {
  const full: IdPayload = { v: 1, ...payload };
  return Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
}

export function decodeId(id: string): IdPayload {
  try {
    const json = Buffer.from(id, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as IdPayload;
    if (obj.v !== 1 || !obj.t || !obj.s || obj.r == null) {
      throw new AniError({ code: AniErrorCode.BadId, message: `malformed id: ${id}` });
    }
    return obj;
  } catch (e) {
    if (e instanceof AniError) throw e;
    throw new AniError({ code: AniErrorCode.BadId, message: `malformed id: ${id}`, cause: e });
  }
}
