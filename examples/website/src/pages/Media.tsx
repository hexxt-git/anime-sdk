import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { Button } from '../components/ui/Button';

export default function Media() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const id = sp.get('id') || '';

  const { data, isFetching, isError, error } = useQuery<api.Media>({
    queryKey: ['media-info', id],
    queryFn: () => api.mediaInfo(id),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  const { data: sources } = useQuery<api.SourceInfo[]>({
    queryKey: ['media-sources', id],
    queryFn: () => api.mediaSources(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  if (isFetching) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-base-350 text-xs tracking-widest">loading...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-64 items-center justify-center px-4">
        <p className="text-xs text-red-900">{isError ? String(error) : 'no data'}</p>
      </div>
    );
  }

  const isManga = data.kind === 'manga';
  const unitLabel = isManga ? 'Read' : 'Watch';

  const availableSources = sources?.filter((s) => s.status === 'available') ?? [];

  const watch = () =>
    navigate(
      `/episodes?id=${encodeURIComponent(id)}&title=${encodeURIComponent(data.title.preferred)}&kind=${data.kind}`,
    );

  return (
    <div className="pb-12">
      {data.banner && (
        <div className="relative h-40 w-full overflow-hidden sm:h-52">
          <img src={data.banner} alt="" className="h-full w-full object-cover opacity-50" />
          <div className="to-base-100 absolute inset-0 bg-gradient-to-b from-transparent" />
        </div>
      )}

      <div className={`px-4 ${data.banner ? 'relative z-10 -mt-12' : 'mt-5'}`}>
        <div className="flex gap-4">
          <div className="shrink-0">
            {data.cover?.url ? (
              <img
                src={data.cover.url}
                alt={data.title.preferred}
                className="h-36 w-24 object-cover sm:h-44 sm:w-28"
                style={data.cover.color ? { borderBottom: `2px solid ${data.cover.color}` } : {}}
              />
            ) : (
              <div className="bg-base-200 h-36 w-24 sm:h-44 sm:w-28" />
            )}
          </div>

          <div className="min-w-0 flex-1 pt-2">
            <h1 className="text-base-900 text-base leading-snug font-normal">
              {data.title.preferred}
            </h1>
            {data.title.romaji && data.title.romaji !== data.title.preferred && (
              <p className="text-base-450 mt-0.5 text-xs">{data.title.romaji}</p>
            )}
            {data.title.native && (
              <p className="text-base-400 mt-0.5 text-[10px]">{data.title.native}</p>
            )}

            <div className="text-base-550 mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
              {data.status && <span>{data.status}</span>}
              {data.format && <span>{data.format}</span>}
              {data.year && <span>{data.year}</span>}
              {data.season && <span>{data.season}</span>}
              {data.score != null && (
                <span className="text-base-700">★ {api.formatScore(data.score)}</span>
              )}
            </div>

            <div className="text-base-450 mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
              {data.episodeCount != null && <span>{data.episodeCount} eps</span>}
              {data.chapterCount != null && <span>{data.chapterCount} chapters</span>}
            </div>
          </div>
        </div>

        {data.description && (
          <p className="text-base-600 mt-3 text-xs leading-relaxed">
            {api.stripHtml(data.description).slice(0, 600)}
            {api.stripHtml(data.description).length > 600 && '…'}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={watch} variant="solid" className="px-5 py-2">
            {unitLabel.toUpperCase()}
          </Button>
        </div>

        {availableSources.length > 0 && (
          <div className="mt-4">
            <p className="text-base-400 mb-2 text-[10px] tracking-widest">AVAILABLE ON</p>
            <div className="flex flex-wrap gap-2">
              {availableSources.map((s) => (
                <span
                  key={s.id}
                  className="border-base-250 text-base-500 border px-2 py-0.5 text-[10px]"
                >
                  {s.id}
                  {s.successRate != null && (
                    <span className="text-base-350 ml-1">{(s.successRate * 100).toFixed(0)}%</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="text-base-400 mb-1 text-[10px] tracking-widest">SOURCE</p>
          <span className="text-base-400 text-[10px]">{data.source}</span>
        </div>

        {data.mappings.anilist && (
          <div className="text-base-350 mt-2 text-[10px]">
            AniList ID: {data.mappings.anilist}
            {data.mappings.mal ? ` · MAL: ${data.mappings.mal}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
