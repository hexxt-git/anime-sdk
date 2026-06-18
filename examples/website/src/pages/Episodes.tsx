import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

export default function Episodes() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const metaProvider = sp.get('meta') || '';
  const metaId = sp.get('id') || '';

  const provider = sp.get('provider') || '';
  const mediaId = sp.get('mid') || '';

  const title = sp.get('title') || mediaId || metaId;
  const type = sp.get('type') || 'ANIME';

  const isManga = type === 'MANGA';
  const unitLabel = isManga ? 'Ch' : 'EP';

  const isMeta = !!(metaProvider && metaId && provider);

  const { data, isFetching, isError, error } = useQuery<api.Episode[]>({
    queryKey: isMeta
      ? ['meta-content', metaProvider, metaId, provider]
      : ['content', provider, mediaId],
    queryFn: () =>
      isMeta ? api.metaContent(metaProvider, metaId, provider) : api.content(provider, mediaId),
    enabled: isMeta ? !!(metaProvider && metaId && provider) : !!(provider && mediaId),
  });

  const goStream = (ep: api.Episode) => {
    if (isMeta) {
      navigate(
        `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}` +
          `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`${unitLabel}.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(ep.id)}&type=${type}` +
          `&meta=${metaProvider}&metaId=${encodeURIComponent(metaId)}`,
      );
    } else {
      navigate(
        `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}` +
          `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`${unitLabel}.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(mediaId)}&type=${type}`,
      );
    }
  };

  return (
    <div className="px-4">
      <div className="mt-5 mb-4">
        <div className="flex items-center gap-2">
          {isMeta && (
            <Link
              to={`/media?meta=${metaProvider}&id=${encodeURIComponent(metaId)}`}
              className="text-base-400 hover:text-base-600 text-[10px] transition-colors"
            >
              ← info
            </Link>
          )}
          <h1 className="text-base-900 text-base tracking-wide">{title}</h1>
        </div>
        {data && (
          <p className="text-base-400 mt-0.5 text-xs">
            {data.length} {isManga ? 'chapters' : 'episodes'}
            {isMeta && <span className="text-base-350 ml-2">via {provider}</span>}
          </p>
        )}
      </div>

      {isFetching && <p className="text-base-350 px-1 text-xs">fetching...</p>}
      {isError && <p className="px-1 text-xs text-red-900">{String(error)}</p>}

      {data && (
        <div className="border-base-200 max-h-[70vh] overflow-y-auto border-t">
          {data.map((ep) => {
            const hasThumb = !!ep.thumbnailUrl;
            return (
              <button
                key={ep.id}
                onClick={() => goStream(ep)}
                className="group border-base-150 hover:bg-base-150 flex w-full items-start gap-3 border-b py-2 text-left transition-colors"
              >
                {hasThumb && (
                  <img
                    src={ep.thumbnailUrl!}
                    alt={ep.title}
                    loading="lazy"
                    className="h-14 w-24 shrink-0 object-cover opacity-80 group-hover:opacity-100"
                  />
                )}
                {!hasThumb && isMeta && <div className="bg-base-100 h-14 w-24 shrink-0" />}

                <div className="min-w-0 flex-1 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base-450 shrink-0 text-[10px]">
                      {unitLabel}.{String(ep.number).padStart(3, '0')}
                    </span>
                    {ep.isFiller && (
                      <span className="text-filler text-[9px] tracking-widest">FILLER</span>
                    )}
                    {ep.isRecap && (
                      <span className="text-recap text-[9px] tracking-widest">RECAP</span>
                    )}
                    {ep.airDate && <span className="text-base-350 text-[9px]">{ep.airDate}</span>}
                  </div>
                  <p className="text-base-700 group-hover:text-base-900 mt-0.5 truncate text-xs transition-colors">
                    {ep.title}
                  </p>
                  {ep.description && (
                    <p className="text-base-400 mt-0.5 line-clamp-1 text-[10px]">
                      {ep.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1 self-center px-2">
                  {ep.availableLanguages?.map((l) => (
                    <span
                      key={l}
                      className="border-base-250 text-base-450 border px-1.5 py-0.5 text-[10px] tracking-widest"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
