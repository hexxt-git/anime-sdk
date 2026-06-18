import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Combobox } from '../components/ui/Select';

const KINDS = ['trending', 'popular', 'seasonal', 'top'] as const;
type Kind = (typeof KINDS)[number];

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;
const CURRENT_YEAR = new Date().getFullYear();

function CoverCard({ result, onClick }: { result: api.MetaSearchResult; onClick: () => void }) {
  const title = api.preferredTitle(result.title);
  const cover = result.cover?.large ?? result.cover?.medium;
  const accent = result.cover?.color;

  return (
    <button
      onClick={onClick}
      className="group border-base-200 hover:border-base-350 relative flex flex-col overflow-hidden border text-left transition-colors"
    >
      <div className="bg-base-150 relative aspect-[2/3] w-full overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover opacity-90 transition-opacity duration-300 group-hover:opacity-100"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center"
            style={{ background: accent ?? '#1a1a1a' }}
          >
            <span className="text-base-450 text-xs">{result.format ?? result.catalogType}</span>
          </div>
        )}
        {result.score != null && (
          <span className="text-base-700 absolute top-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 text-[10px] tracking-wide">
            ★ {(result.score / 10).toFixed(1)}
          </span>
        )}
        {result.isAdult && (
          <span className="absolute top-1.5 left-1.5 bg-red-900/80 px-1 py-0.5 text-[9px] tracking-widest text-red-300">
            18+
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <p className="text-base-800 group-hover:text-base-900 line-clamp-2 text-xs">{title}</p>
        <p className="text-base-400 text-[10px]">
          {[result.format, result.year].filter(Boolean).join(' · ')}
        </p>
      </div>
    </button>
  );
}

export default function Browse() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const metaProvider = (sp.get('meta') as api.MetaProvider) || 'anilist';
  const kind = (sp.get('kind') as Kind) || 'trending';
  const catalogType = sp.get('type') || 'ANIME';
  const season = sp.get('season') || '';
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;

  const [searchInput, setSearchInput] = useState('');

  const { data, isFetching, isError, error } = useQuery<api.MetaSearchResult[]>({
    queryKey: ['browse', metaProvider, kind, catalogType, season, year],
    queryFn: () =>
      api.metaBrowse(metaProvider, kind, {
        catalogType,
        perPage: 24,
        season: season || undefined,
        year,
      }),
    staleTime: 5 * 60 * 1000,
  });

  const setParam = (key: string, value: string) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set(key, value);
      return next;
    });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim())
      navigate(`/search?meta=${metaProvider}&q=${encodeURIComponent(searchInput.trim())}`);
  };

  const goMedia = (r: api.MetaSearchResult) =>
    navigate(`/media?meta=${metaProvider}&id=${encodeURIComponent(r.id)}`);

  const seasonOptions = [
    { value: '', label: 'season' },
    ...SEASONS.map((s) => ({ value: s, label: s })),
  ];

  const yearOptions = [
    { value: '', label: 'year' },
    ...Array.from({ length: 15 }, (_, i) => CURRENT_YEAR - i).map((y) => ({
      value: String(y),
      label: String(y),
    })),
  ];

  return (
    <div className="px-4 pb-10">
      <form onSubmit={handleSearch} className="mt-5 flex gap-2">
        <Input
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => {
            if (searchInput.trim())
              navigate(`/search?meta=${metaProvider}&q=${encodeURIComponent(searchInput.trim())}`);
          }}
          placeholder="search anime, manga..."
        />
        <Button type="submit" variant="solid" className="px-5 py-2">
          SEARCH
        </Button>
      </form>

      <div className="border-base-200 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3">
        <div className="flex gap-1">
          {api.META_PROVIDERS.map((p) => (
            <Button
              key={p}
              onClick={() => setParam('meta', p)}
              variant="outline"
              active={p === metaProvider}
              className="px-2.5 py-1"
            >
              {p}
            </Button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['ANIME', 'MANGA'] as const).map((t) => (
            <Button
              key={t}
              onClick={() => setParam('type', t)}
              variant="outline"
              active={t === catalogType}
              className="px-2.5 py-1"
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
        {KINDS.map((k) => (
          <Button
            key={k}
            onClick={() => setParam('kind', k)}
            variant="outline"
            active={k === kind}
            className="px-3 py-1.5"
          >
            {k}
          </Button>
        ))}

        {kind === 'seasonal' && (
          <>
            <Combobox
              value={season}
              onValueChange={(v) => setParam('season', v)}
              options={seasonOptions}
            />
            <Combobox
              value={year ? String(year) : ''}
              onValueChange={(v) => {
                const next = new URLSearchParams(sp);
                if (v) next.set('year', v);
                else next.delete('year');
                setSp(next);
              }}
              options={yearOptions}
            />
          </>
        )}
      </div>

      {isFetching && <p className="text-base-350 mt-8 text-xs">loading...</p>}
      {isError && <p className="mt-8 text-xs text-red-900">{String(error)}</p>}

      {data && (
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {data.map((r) => (
            <CoverCard key={r.id} result={r} onClick={() => goMedia(r)} />
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-base-350 mt-8 text-xs">no results for this combination</p>
      )}
    </div>
  );
}
