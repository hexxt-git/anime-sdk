import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

export default function Episodes() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const mediaId = sp.get('id') || '';
  const title = sp.get('title') || mediaId;
  const kind = (sp.get('kind') ?? 'anime') as 'anime' | 'manga';

  const isManga = kind === 'manga';
  const unitLabel = isManga ? 'Ch' : 'EP';

  const {
    data: episodeList,
    isFetching: epFetching,
    isError: epError,
    error: epErr,
  } = useQuery<api.List<api.Episode>>({
    queryKey: ['episodes', mediaId],
    queryFn: () => api.mediaEpisodes(mediaId),
    enabled: !isManga && !!mediaId,
  });

  const {
    data: chapterList,
    isFetching: chFetching,
    isError: chError,
    error: chErr,
  } = useQuery<api.List<api.Chapter>>({
    queryKey: ['chapters', mediaId],
    queryFn: () => api.mediaChapters(mediaId),
    enabled: isManga && !!mediaId,
  });

  const items = isManga ? chapterList?.items : episodeList?.items;
  const isFetching = epFetching || chFetching;
  const isError = epError || chError;
  const error = epErr || chErr;

  const goStream = (item: api.Episode | api.Chapter) => {
    if (isManga) {
      const ch = item as api.Chapter;
      navigate(
        `/stream?chid=${encodeURIComponent(ch.id)}&title=${encodeURIComponent(title)}&mid=${encodeURIComponent(mediaId)}`,
      );
    } else {
      const ep = item as api.Episode;
      const params = new URLSearchParams({
        epid: ep.id,
        title,
        mid: mediaId,
      });
      // Thread the episode's available languages through to the stream page
      // so its language switcher reflects what's actually playable.
      if (ep.languages && ep.languages.length > 0) {
        params.set('langs', ep.languages.join(','));
      }
      navigate(`/stream?${params.toString()}`);
    }
  };

  return (
    <div className="px-4">
      <div className="mt-5 mb-4">
        <div className="flex items-center gap-2">
          <Link
            to={`/media?id=${encodeURIComponent(mediaId)}`}
            className="text-base-400 hover:text-base-600 text-[10px] transition-colors"
          >
            ← info
          </Link>
          <h1 className="text-base-900 text-base tracking-wide">{title}</h1>
        </div>
        {items && (
          <p className="text-base-400 mt-0.5 text-xs">
            {items.length} {isManga ? 'chapters' : 'episodes'}
          </p>
        )}
      </div>

      {isFetching && <p className="text-base-350 px-1 text-xs">fetching...</p>}
      {isError && <p className="px-1 text-xs text-red-900">{String(error)}</p>}

      {items && items.length === 0 && !isFetching && (
        <p className="text-base-350 px-1 text-xs">
          no {isManga ? 'chapters' : 'episodes'} returned from any source
        </p>
      )}

      {items && items.length > 0 && (
        <div className="border-base-200 max-h-[70vh] overflow-y-auto border-t">
          {items.map((item) => {
            const ep = item as api.Episode;
            const ch = item as api.Chapter;
            const thumbnail = !isManga ? ep.thumbnail : undefined;
            return (
              <button
                key={item.id}
                onClick={() => goStream(item)}
                className="group border-base-150 hover:bg-base-150 flex w-full items-start gap-3 border-b py-2 text-left transition-colors"
              >
                {thumbnail && (
                  <img
                    src={thumbnail}
                    alt={item.title}
                    loading="lazy"
                    className="h-14 w-24 shrink-0 object-cover opacity-80 group-hover:opacity-100"
                  />
                )}

                <div className="min-w-0 flex-1 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base-450 shrink-0 text-[10px]">
                      {unitLabel}.{String(item.number).padStart(3, '0')}
                    </span>
                    {!isManga && ep.filler && (
                      <span className="text-filler text-[9px] tracking-widest">FILLER</span>
                    )}
                    {!isManga && ep.recap && (
                      <span className="text-recap text-[9px] tracking-widest">RECAP</span>
                    )}
                    {!isManga && ep.airDate && (
                      <span className="text-base-350 text-[9px]">{ep.airDate}</span>
                    )}
                  </div>
                  <p className="text-base-700 group-hover:text-base-900 mt-0.5 truncate text-xs transition-colors">
                    {item.title}
                  </p>
                </div>

                {!isManga && ep.languages && ep.languages.length > 0 && (
                  <div className="flex shrink-0 gap-1 self-center px-2">
                    {ep.languages.map((l) => (
                      <span
                        key={l}
                        className="border-base-250 text-base-450 border px-1.5 py-0.5 text-[10px] tracking-widest"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
