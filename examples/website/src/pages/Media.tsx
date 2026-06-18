import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { Button } from '../components/ui/Button';
import { Combobox } from '../components/ui/Select';
import { SectionCollapsible, Expandable } from '../components/ui/Collapsible';

function PersonCard({
  name,
  role,
  image,
  sub,
}: {
  name: string;
  role?: string;
  image?: api.MetaCover;
  sub?: string;
}) {
  const src = image?.large ?? image?.medium;
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div className="bg-base-150 h-20 w-14 overflow-hidden">
        {src ? (
          <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="bg-base-200 h-full w-full" />
        )}
      </div>
      <p className="text-base-800 line-clamp-2 text-[10px] leading-tight">{name}</p>
      {role && <p className="text-base-450 text-[9px]">{role}</p>}
      {sub && <p className="text-base-400 text-[9px]">{sub}</p>}
    </div>
  );
}

function RelationCard({ rel }: { rel: api.MediaRelation }) {
  const title = api.preferredTitle(rel.title);
  const cover = rel.cover?.medium ?? rel.cover?.large;
  return (
    <div className="border-base-150 flex items-center gap-3 border-b py-2">
      {cover ? (
        <img src={cover} alt={title} className="h-14 w-10 shrink-0 object-cover" loading="lazy" />
      ) : (
        <div className="bg-base-200 h-14 w-10 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-base-450 text-[10px] tracking-widest">{rel.relationType}</p>
        <p className="text-base-800 truncate text-xs">{title}</p>
        <p className="text-base-400 text-[10px]">
          {[rel.format, rel.status].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

export default function Media() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const metaProvider = sp.get('meta') || 'anilist';
  const id = sp.get('id') || '';

  const [contentProvider, setContentProvider] = useState<string>(api.CONTENT_PROVIDERS[0]);

  const { data, isFetching, isError, error } = useQuery<api.MediaMetadata>({
    queryKey: ['meta-info', metaProvider, id],
    queryFn: () => api.metaInfo(metaProvider, id),
    enabled: !!(metaProvider && id),
    staleTime: 10 * 60 * 1000,
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

  const title = api.preferredTitle(data.title);
  const isManga = data.catalogType === 'MANGA';
  const unitLabel = isManga ? 'Read' : 'Watch';

  const watch = () =>
    navigate(
      `/episodes?meta=${metaProvider}&id=${encodeURIComponent(id)}&provider=${contentProvider}&title=${encodeURIComponent(title)}&type=${data.catalogType}`,
    );

  const providerOptions = api.CONTENT_PROVIDERS.map((p) => ({ value: p, label: p }));

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
            {data.cover?.large ? (
              <img
                src={data.cover.large}
                alt={title}
                className="h-36 w-24 object-cover sm:h-44 sm:w-28"
                style={data.cover.color ? { borderBottom: `2px solid ${data.cover.color}` } : {}}
              />
            ) : (
              <div className="bg-base-200 h-36 w-24 sm:h-44 sm:w-28" />
            )}
          </div>

          <div className="min-w-0 flex-1 pt-2">
            <h1 className="text-base-900 text-base leading-snug font-normal">{title}</h1>
            {data.title.romaji && data.title.romaji !== title && (
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
                <span className="text-base-700">★ {(data.score / 10).toFixed(1)}</span>
              )}
            </div>

            <div className="text-base-450 mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
              {data.episodeCount != null && <span>{data.episodeCount} eps</span>}
              {data.chapterCount != null && <span>{data.chapterCount} chapters</span>}
              {data.durationMinutes != null && <span>{data.durationMinutes}min</span>}
              {data.studios?.slice(0, 2).map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {data.genres && data.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.genres.map((g) => (
              <span
                key={g}
                className="border-base-250 text-base-500 border px-2 py-0.5 text-[10px]"
              >
                {g}
              </span>
            ))}
          </div>
        )}

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
          <div className="flex items-center gap-1">
            <span className="text-base-400 text-[10px]">via</span>
            <Combobox
              value={contentProvider}
              onValueChange={setContentProvider}
              options={providerOptions}
            />
          </div>
        </div>

        {data.trailer && (
          <a
            href={data.trailer}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base-400 hover:text-base-600 mt-2 inline-block text-[10px] transition-colors"
          >
            ▶ trailer ↗
          </a>
        )}
      </div>

      <div className="mt-6 space-y-0 px-4">
        {data.streamingEpisodes && data.streamingEpisodes.length > 0 && (
          <SectionCollapsible
            label="Episodes"
            count={data.streamingEpisodes.length}
            defaultOpen={true}
          >
            <Expandable limit={8} label="episodes">
              {data.streamingEpisodes.map((ep) => (
                <div
                  key={ep.number}
                  className="border-base-150 mb-2 flex items-start gap-3 border-b pb-2"
                >
                  {ep.thumbnail && (
                    <img
                      src={ep.thumbnail}
                      alt={ep.title ?? `EP ${ep.number}`}
                      className="h-14 w-24 shrink-0 object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base-450 text-[10px]">
                        EP.{String(ep.number).padStart(3, '0')}
                      </span>
                      {ep.isFiller && (
                        <span className="text-filler text-[9px] tracking-widest">FILLER</span>
                      )}
                      {ep.isRecap && (
                        <span className="text-recap text-[9px] tracking-widest">RECAP</span>
                      )}
                    </div>
                    {ep.title && (
                      <p className="text-base-700 mt-0.5 truncate text-xs">{ep.title}</p>
                    )}
                    {ep.airDate && <p className="text-base-400 mt-0.5 text-[10px]">{ep.airDate}</p>}
                  </div>
                </div>
              ))}
            </Expandable>
          </SectionCollapsible>
        )}

        {data.externalLinks && data.externalLinks.length > 0 && (
          <SectionCollapsible label="Links" defaultOpen={true}>
            <div className="flex flex-wrap gap-2">
              {data.externalLinks.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:border-base-450 hover:text-base-900 border px-3 py-1.5 text-[10px] tracking-wide transition-colors ${link.type === 'STREAMING' ? 'border-base-350 text-base-600' : 'border-base-200 text-base-450'}`}
                >
                  {link.site}
                  {link.language && <span className="text-base-400 ml-1">({link.language})</span>}
                </a>
              ))}
            </div>
          </SectionCollapsible>
        )}

        {data.characters && data.characters.length > 0 && (
          <SectionCollapsible label="Characters" count={data.characters.length} defaultOpen={false}>
            <Expandable limit={12} label="characters">
              {data.characters.map((c) => {
                const va =
                  c.voiceActors?.find((v) => v.language === 'Japanese') ?? c.voiceActors?.[0];
                return (
                  <div key={c.id} className="inline-block w-1/4 p-1 sm:w-1/5 md:w-1/6">
                    <PersonCard name={c.name} role={c.role} image={c.image} sub={va?.name} />
                  </div>
                );
              })}
            </Expandable>
          </SectionCollapsible>
        )}

        {data.staff && data.staff.length > 0 && (
          <SectionCollapsible label="Staff" count={data.staff.length} defaultOpen={false}>
            <Expandable limit={12} label="staff">
              {data.staff.map((s) => (
                <div key={s.id} className="inline-block w-1/4 p-1 sm:w-1/5 md:w-1/6">
                  <PersonCard name={s.name} role={s.role} image={s.image} />
                </div>
              ))}
            </Expandable>
          </SectionCollapsible>
        )}

        {data.relations && data.relations.length > 0 && (
          <SectionCollapsible label="Relations" count={data.relations.length} defaultOpen={true}>
            <div className="flex flex-col">
              {data.relations.map((r) => (
                <RelationCard key={r.id} rel={r} />
              ))}
            </div>
          </SectionCollapsible>
        )}

        {data.recommendations && data.recommendations.length > 0 && (
          <SectionCollapsible
            label="Recommendations"
            count={data.recommendations.length}
            defaultOpen={false}
          >
            <Expandable limit={10} label="recs">
              {data.recommendations.map((r) => {
                const recTitle = api.preferredTitle(r.title);
                const cover = r.cover?.large ?? r.cover?.medium;
                return (
                  <Link
                    key={r.id}
                    to={`/media?meta=${metaProvider}&id=${encodeURIComponent(r.id)}`}
                    className="group border-base-200 hover:border-base-350 inline-flex w-1/3 flex-col overflow-hidden border p-1 transition-colors sm:w-1/4 md:w-1/5"
                  >
                    <div className="bg-base-150 relative aspect-[2/3]">
                      {cover ? (
                        <img
                          src={cover}
                          alt={recTitle}
                          loading="lazy"
                          className="h-full w-full object-cover opacity-80 group-hover:opacity-100"
                        />
                      ) : (
                        <div className="bg-base-200 h-full w-full" />
                      )}
                      {r.rating != null && (
                        <span className="text-base-600 absolute top-1 right-1 bg-black/80 px-1 py-0.5 text-[9px]">
                          ★ {r.rating}
                        </span>
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="text-base-700 group-hover:text-base-900 line-clamp-2 text-[10px] leading-tight">
                        {recTitle}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </Expandable>
          </SectionCollapsible>
        )}

        {data.tags && data.tags.length > 0 && (
          <SectionCollapsible label="Tags" defaultOpen={false}>
            <Expandable limit={20} label="tags">
              {data.tags.map((t, i) => (
                <span key={i} className="text-base-400 mr-2 text-[10px]">
                  {t}
                  {i < data.tags!.length - 1 ? ',' : ''}
                </span>
              ))}
            </Expandable>
          </SectionCollapsible>
        )}

        {data.synonyms && data.synonyms.length > 0 && (
          <SectionCollapsible label="Also Known As" defaultOpen={false}>
            <div className="flex flex-col gap-1">
              {data.synonyms.map((s, i) => (
                <p key={i} className="text-base-450 text-xs">
                  {s}
                </p>
              ))}
            </div>
          </SectionCollapsible>
        )}
      </div>
    </div>
  );
}
