import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

type Mode = 'meta' | 'content';

export default function Search() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const mode = (sp.get('mode') as Mode) || (sp.get('meta') ? 'meta' : 'content');
  const metaProvider = (sp.get('meta') as api.MetaProvider) || 'anilist';
  const contentProvider = sp.get('provider') || api.CONTENT_PROVIDERS[0];
  const initialQ = sp.get('q') || '';

  const [input, setInput] = useState(initialQ);

  const setParam = (key: string, value: string) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set(key, value);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('q', input);
      next.set('mode', mode);
      return next;
    });
  };

  const metaQuery = useQuery<api.MetaSearchResult[]>({
    queryKey: ['meta-search', metaProvider, initialQ],
    queryFn: () => api.metaSearch(metaProvider, initialQ),
    enabled: mode === 'meta' && !!initialQ,
  });

  const contentQuery = useQuery<api.SearchResult[]>({
    queryKey: ['search', contentProvider, initialQ],
    queryFn: () => api.search(contentProvider, initialQ),
    enabled: mode === 'content' && !!initialQ,
  });

  const isFetching = mode === 'meta' ? metaQuery.isFetching : contentQuery.isFetching;
  const isError = mode === 'meta' ? metaQuery.isError : contentQuery.isError;
  const error = mode === 'meta' ? metaQuery.error : contentQuery.error;

  const goMedia = (r: api.MetaSearchResult) =>
    navigate(`/media?meta=${metaProvider}&id=${encodeURIComponent(r.id)}`);

  const goEpisodes = (r: api.SearchResult) =>
    navigate(
      `/episodes?provider=${contentProvider}&mid=${encodeURIComponent(r.id)}&title=${encodeURIComponent(r.title)}&type=${r.catalogType}`,
    );

  return (
    <div className="px-4">
      <div className="border-base-200 mt-5 flex gap-0.5 border-b pb-3">
        {(['meta', 'content'] as const).map((m) => (
          <Button
            key={m}
            onClick={() => setParam('mode', m)}
            variant="tab"
            active={m === mode}
            className="mr-3"
          >
            {m === 'meta' ? 'Catalogue' : 'Provider'}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {mode === 'meta'
          ? api.META_PROVIDERS.map((p) => (
              <Button
                key={p}
                onClick={() => setParam('meta', p)}
                variant="outline"
                active={p === metaProvider}
                className="px-3 py-1.5"
              >
                {p}
              </Button>
            ))
          : api.CONTENT_PROVIDERS.map((p) => (
              <Button
                key={p}
                onClick={() => setParam('provider', p)}
                variant="outline"
                active={p === contentProvider}
                className="px-3 py-1.5"
              >
                {p}
              </Button>
            ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <Input
          value={input}
          onChange={setInput}
          onSubmit={() => {
            setSp((prev) => {
              const next = new URLSearchParams(prev);
              next.set('q', input);
              next.set('mode', mode);
              return next;
            });
          }}
          placeholder="search title..."
        />
        <Button type="submit" variant="solid" className="px-5 py-2">
          SEARCH
        </Button>
      </form>

      {isFetching && <p className="text-base-350 mt-6 px-1 text-xs">fetching...</p>}
      {isError && <p className="mt-6 px-1 text-xs text-red-900">{String(error)}</p>}

      {mode === 'meta' && metaQuery.data && (
        <div className="border-base-200 mt-6 border-t">
          <div className="text-base-400 px-1 py-2 text-xs tracking-widest">
            RESULTS <span className="text-base-350">({metaQuery.data.length})</span>
          </div>
          {metaQuery.data.map((r) => {
            const title = api.preferredTitle(r.title);
            const cover = r.cover?.medium ?? r.cover?.large;
            return (
              <button
                key={r.id}
                onClick={() => goMedia(r)}
                className="group border-base-150 hover:bg-base-150 flex w-full items-center gap-3 border-b px-2 py-2.5 text-left transition-colors"
              >
                {cover ? (
                  <img
                    src={cover}
                    alt={title}
                    className="h-12 w-9 shrink-0 object-cover opacity-80 group-hover:opacity-100"
                    loading="lazy"
                  />
                ) : (
                  <div className="bg-base-200 h-12 w-9 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base-750 group-hover:text-base-900 truncate text-sm">
                    {title}
                  </p>
                  {r.title.native && r.title.native !== title && (
                    <p className="text-base-350 truncate text-xs">{r.title.native}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {r.score != null && (
                    <span className="text-base-450 text-[10px]">★ {(r.score / 10).toFixed(1)}</span>
                  )}
                  <span className="text-base-350 text-[10px]">{r.format ?? r.catalogType}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {mode === 'content' && contentQuery.data && (
        <div className="border-base-200 mt-6 border-t">
          <div className="text-base-400 px-1 py-2 text-xs tracking-widest">
            RESULTS <span className="text-base-350">({contentQuery.data.length})</span>
          </div>
          {contentQuery.data.map((r) => (
            <button
              key={r.id}
              onClick={() => goEpisodes(r)}
              className="group border-base-150 hover:bg-base-150 flex w-full items-center justify-between gap-4 border-b px-2 py-2.5 text-left transition-colors"
            >
              <span className="text-base-750 group-hover:text-base-900 flex-1 truncate">
                {r.title}
              </span>
              {r.availableLanguages && r.availableLanguages.length > 0 && (
                <span className="flex shrink-0 gap-1">
                  {r.availableLanguages.map((l) => (
                    <span
                      key={l}
                      className="border-base-250 text-base-450 border px-1.5 py-0.5 text-[10px] tracking-widest"
                    >
                      {l}
                    </span>
                  ))}
                </span>
              )}
              <span className="text-base-350 shrink-0 text-xs">{r.catalogType}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
