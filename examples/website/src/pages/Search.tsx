import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export default function Search() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const kind = (sp.get('kind') ?? 'anime') as 'anime' | 'manga';
  const initialQ = sp.get('q') || '';
  const [input, setInput] = useState(initialQ);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('q', input);
      return next;
    });
  };

  const { data, isFetching, isError, error } = useQuery<api.Media[]>({
    queryKey: ['search', kind, initialQ],
    queryFn: () => api.search(initialQ, kind),
    enabled: !!initialQ,
  });

  const goMedia = (m: api.Media) => navigate(`/media?id=${encodeURIComponent(m.id)}`);

  return (
    <div className="px-4">
      <div className="border-base-200 mt-5 flex gap-0.5 border-b pb-3">
        {(['anime', 'manga'] as const).map((k) => (
          <Button
            key={k}
            onClick={() =>
              setSp((prev) => {
                const next = new URLSearchParams(prev);
                next.set('kind', k);
                return next;
              })
            }
            variant="tab"
            active={k === kind}
            className="mr-3"
          >
            {k}
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

      {data && data.length === 0 && !isFetching && (
        <p className="text-base-350 mt-6 px-1 text-xs">
          no {kind} matched "{initialQ}"
        </p>
      )}

      {data && data.length > 0 && (
        <div className="border-base-200 mt-6 border-t">
          <div className="text-base-400 px-1 py-2 text-xs tracking-widest">
            RESULTS <span className="text-base-350">({data.length})</span>
          </div>
          {data.map((r) => (
            <button
              key={r.id}
              onClick={() => goMedia(r)}
              className="group border-base-150 hover:bg-base-150 flex w-full items-center gap-3 border-b px-2 py-2.5 text-left transition-colors"
            >
              {r.cover?.url ? (
                <img
                  src={r.cover.url}
                  alt={r.title.preferred}
                  className="h-12 w-9 shrink-0 object-cover opacity-80 group-hover:opacity-100"
                  loading="lazy"
                />
              ) : (
                <div className="bg-base-200 h-12 w-9 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-base-750 group-hover:text-base-900 truncate text-sm">
                  {r.title.preferred}
                </p>
                {r.title.native && r.title.native !== r.title.preferred && (
                  <p className="text-base-350 truncate text-xs">{r.title.native}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {r.score != null && (
                  <span className="text-base-450 text-[10px]">★ {api.formatScore(r.score)}</span>
                )}
                <span className="text-base-350 text-[10px]">{r.format ?? r.kind}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
