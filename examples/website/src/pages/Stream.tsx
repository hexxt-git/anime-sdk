import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import * as api from '../api';
import { Combobox } from '../components/ui/Select';
import { SectionCollapsible } from '../components/ui/Collapsible';

type DownloadPhase = 'idle' | 'active' | 'done' | 'error';

function DownloadButton({
  provider,
  unitId,
  language,
  type,
}: {
  provider: string;
  unitId: string;
  language: string;
  type: 'video' | 'manga';
}) {
  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [label, setLabel] = useState('');
  const esRef = useRef<EventSource | null>(null);

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
  };

  useEffect(() => stop, []);

  const start = () => {
    if (phase === 'active') {
      stop();
      setPhase('idle');
      return;
    }

    const progressPath =
      type === 'video'
        ? `/download/video/progress?provider=${provider}&unitId=${encodeURIComponent(unitId)}&language=${language}`
        : `/download/manga/chapter/progress?provider=${provider}&unitId=${encodeURIComponent(unitId)}`;
    const filePath = type === 'video' ? '/download/video/file' : '/download/manga/chapter/file';

    setPhase('active');
    setLabel('connecting…');

    const es = new EventSource(`${api.API}${progressPath}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as Record<string, unknown>;
      if (data.type === 'progress') {
        if (type === 'manga') {
          setLabel(`${data.downloaded}/${data.total} pages`);
        } else {
          const detail = data.detail as string | undefined;
          setLabel(detail ?? (data.phase as string));
        }
      } else if (data.type === 'complete') {
        stop();
        setPhase('done');
        setLabel('');
        const a = document.createElement('a');
        a.href = `${api.API}${filePath}?token=${data.token}`;
        a.click();
        setTimeout(() => setPhase('idle'), 3000);
      } else if (data.type === 'error') {
        stop();
        setPhase('error');
        setLabel((data.message as string | undefined) ?? 'failed');
        setTimeout(() => setPhase('idle'), 4000);
      }
    };

    es.onerror = () => {
      stop();
      setPhase('error');
      setLabel('connection failed');
      setTimeout(() => setPhase('idle'), 3000);
    };
  };

  if (phase === 'idle') {
    return (
      <button
        onClick={start}
        className="text-base-400 hover:text-base-600 text-xs tracking-widest transition-colors"
      >
        {type === 'manga' ? 'DOWNLOAD ZIP' : 'DOWNLOAD'}
      </button>
    );
  }

  if (phase === 'done') {
    return <span className="text-success text-xs tracking-widest">SAVED</span>;
  }

  if (phase === 'error') {
    return (
      <button
        onClick={() => setPhase('idle')}
        title={label}
        className="text-danger text-xs tracking-widest transition-colors hover:text-red-700"
      >
        FAILED ✕
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-base-450 max-w-[200px] truncate text-xs">{label}</span>
      <button
        onClick={start}
        className="text-base-350 hover:text-danger text-xs tracking-widest transition-colors"
      >
        CANCEL
      </button>
    </div>
  );
}

function Player({
  stream,
  subtitles,
  langUI,
}: {
  stream: api.VideoStream;
  subtitles: api.SubtitleTrack[];
  langUI?: React.ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [hlsSubTracks, setHlsSubTracks] = useState<{ id: number; name: string; lang: string }[]>(
    [],
  );
  const [activeSub, setActiveSub] = useState<number>(-1);
  const hlsRef = useRef<Hls | undefined>(undefined);
  const externalSubs = subtitles;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setPlayerError(null);
    setHlsSubTracks([]);
    setActiveSub(externalSubs.length > 0 ? 0 : -1);

    let hls: Hls | undefined;
    if (stream.isHLS) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.subtitleDisplay = true;
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayerError(`HLS error: ${d.details}`);
        });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, d) => {
          const tracks = (d.subtitleTracks ?? []).map((t: any) => ({
            id: t.id,
            name: t.name ?? t.lang ?? `Track ${t.id}`,
            lang: t.lang ?? '',
          }));
          setHlsSubTracks(tracks);
          if (tracks.length > 0 && externalSubs.length === 0) {
            hls!.subtitleTrack = 0;
            setActiveSub(1000);
          } else {
            hls!.subtitleTrack = -1;
          }
        });
        hls.loadSource(stream.sourceUrl);
        hls.attachMedia(v);
        hlsRef.current = hls;
        v.play().catch(() => {});
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = stream.sourceUrl;
        v.play().catch(() => {});
      } else {
        setPlayerError('HLS not supported in this browser');
      }
    } else {
      v.src = stream.sourceUrl;
      v.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
      hlsRef.current = undefined;
      v.src = '';
    };
  }, [stream.sourceUrl, stream.isHLS, externalSubs.length]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const textTracks = v.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      textTracks[i].mode = activeSub === i ? 'showing' : 'disabled';
    }
  }, [activeSub, externalSubs.length]);

  const selectSub = (key: number) => {
    setActiveSub(key);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = key >= 1000 ? key - 1000 : -1;
    }
  };

  const hasSubtitleUI = hlsSubTracks.length > 0 || externalSubs.length > 0;

  if (playerError) {
    return (
      <div className="border-base-200 bg-base-100 flex aspect-video items-center justify-center border">
        <p className="text-base-400 text-xs">{playerError}</p>
      </div>
    );
  }

  return (
    <div>
      <video
        ref={ref}
        controls
        crossOrigin="anonymous"
        className="border-base-200 bg-base-0 mb-4 aspect-video w-full border"
      >
        {externalSubs.map((s, i) => (
          <track
            key={`${stream.sourceUrl}-${i}`}
            kind="subtitles"
            src={s.url}
            srcLang={s.language}
            label={s.label}
          />
        ))}
      </video>
      {langUI}
      {hasSubtitleUI && (
        <div className="border-base-200 flex items-center gap-2 border-t px-1 py-2">
          <span className="text-base-400 text-xs tracking-widest">SUB</span>
          <Combobox
            value={String(activeSub)}
            onValueChange={(v) => selectSub(Number(v))}
            options={[
              { value: '-1', label: 'off' },
              ...externalSubs.map((s, i) => ({ value: String(i), label: s.label })),
              ...hlsSubTracks.map((t) => ({ value: String(1000 + t.id), label: t.name })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

function MangaReader({ pages }: { pages: api.MangaStream }) {
  return (
    <div className="bg-base-0 mb-4 flex flex-col items-center gap-4">
      {pages.imageUrls.map((url, i) => (
        <img
          key={i}
          src={url}
          alt={`Page ${i + 1}`}
          className="min-h-64 max-w-full"
          loading="lazy"
        />
      ))}
    </div>
  );
}

export default function Stream() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const provider = sp.get('provider') || '';
  const unitId = sp.get('uid') || '';
  const title = sp.get('title') || '';
  const mediaId = sp.get('mid') || '';
  const epLabel = sp.get('ep') || '';
  const type = sp.get('type') || 'ANIME';
  const metaProvider = sp.get('meta') || '';
  const metaId = sp.get('metaId') || '';

  const isManga = type === 'MANGA';
  const unitLabel = isManga ? 'CHAPTERS' : 'EPISODES';
  const unitPrefix = isManga ? 'Chapter' : 'EP';

  const [lang, setLang] = useState<api.Lang>('sub');
  const [activeIdx, setActiveIdx] = useState(0);
  const [showEpisodes, setShowEpisodes] = useState(false);

  const { data: episodes } = useQuery<api.Episode[]>({
    queryKey: ['content', provider, mediaId],
    queryFn: () => api.content(provider, mediaId),
    enabled: !!(provider && mediaId),
    staleTime: 5 * 60 * 1000,
  });

  const currentEpNum = epLabel ? parseFloat(epLabel.replace(/^[A-Z]+\./i, '')) : null;
  const currentIdx = episodes?.findIndex((e) => e.number === currentEpNum) ?? -1;
  const currentEpisode = currentIdx >= 0 ? episodes![currentIdx] : null;
  const availableLangs = currentEpisode?.availableLanguages ?? ['sub'];

  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(lang)) {
      setLang(availableLangs[0]);
    }
  }, [availableLangs, lang]);

  const { data, isFetching, isError, error } = useQuery<api.ResolvedStream>({
    queryKey: ['stream', provider, unitId, lang],
    queryFn: () => api.stream(provider, unitId, lang),
    enabled: !!(provider && unitId),
  });

  const streams = data?.type === 'video' ? (data.streams ?? []) : [];
  const active = streams[activeIdx] ?? null;
  const subtitles = active?.subtitles ?? [];

  const prevEp = currentIdx > 0 ? episodes![currentIdx - 1] : null;
  const nextEp =
    currentIdx >= 0 && currentIdx < (episodes?.length ?? 0) - 1 ? episodes![currentIdx + 1] : null;

  const goEpisode = (ep: api.Episode) => {
    const base =
      `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}` +
      `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`${unitPrefix}.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(mediaId)}&type=${type}`;
    navigate(
      metaProvider && metaId
        ? `${base}&meta=${metaProvider}&metaId=${encodeURIComponent(metaId)}`
        : base,
    );
  };

  const infoHref =
    metaProvider && metaId ? `/media?meta=${metaProvider}&id=${encodeURIComponent(metaId)}` : null;

  useEffect(() => {
    setActiveIdx(0);
  }, [unitId, lang]);

  return (
    <div className="px-4">
      {infoHref && (
        <div className="text-base-400 mt-4 flex items-center gap-2 text-[10px]">
          <Link to={infoHref} className="hover:text-base-600 transition-colors">
            ← {title}
          </Link>
          {epLabel && <span className="text-base-300">/ {epLabel}</span>}
        </div>
      )}
      <div className="mt-5">
        {isFetching && (
          <div className="border-base-200 bg-base-100 flex aspect-video items-center justify-center border">
            <p className="text-base-350 text-xs tracking-widest">
              resolving {isManga ? 'pages' : 'stream'}...
            </p>
          </div>
        )}
        {isError && (
          <div className="border-base-200 bg-base-100 flex aspect-video items-center justify-center border">
            <p className="text-xs text-red-900">{String(error)}</p>
          </div>
        )}
        {data?.type === 'video' && active && (
          <Player
            key={active.sourceUrl}
            stream={active}
            subtitles={subtitles}
            langUI={
              availableLangs.length > 1 && (
                <div className="border-base-200 flex items-center gap-2 border-t px-1 py-2">
                  <span className="text-base-400 text-xs tracking-widest">LANG</span>
                  {availableLangs.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`text-xs tracking-widest uppercase transition-colors ${lang === l ? 'text-base-900' : 'text-base-400 hover:text-base-700'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )
            }
          />
        )}
        {data?.type === 'manga' && data.pages && (
          <>
            <MangaReader pages={data.pages} />
            <div className="border-base-200 flex items-center justify-end border-t px-1 py-2">
              <DownloadButton provider={provider} unitId={unitId} language={lang} type="manga" />
            </div>
            {availableLangs.length > 1 && (
              <div className="border-base-200 flex items-center gap-2 border-t px-1 py-2">
                <span className="text-base-400 text-xs tracking-widest">LANG</span>
                {availableLangs.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`text-xs tracking-widest uppercase transition-colors ${lang === l ? 'text-base-900' : 'text-base-400 hover:text-base-700'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {episodes && (
        <div className="border-base-200 mb-0 border-t">
          <div className="flex items-center justify-between px-1 py-2">
            <button
              onClick={() => setShowEpisodes((v) => !v)}
              className="text-base-400 hover:text-base-550 text-xs tracking-widest transition-colors"
            >
              {unitLabel} <span className="text-base-350">({episodes.length})</span>{' '}
              {showEpisodes ? '▲' : '▼'}
            </button>
            <div className="flex gap-3">
              <button
                disabled={!prevEp}
                onClick={() => prevEp && goEpisode(prevEp)}
                className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
              >
                ← PREV
              </button>
              <button
                disabled={!nextEp}
                onClick={() => nextEp && goEpisode(nextEp)}
                className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
              >
                NEXT →
              </button>
            </div>
          </div>

          {showEpisodes && (
            <div className="border-base-150 max-h-64 overflow-y-auto border-t">
              {episodes.map((ep) => {
                const isCurrent = ep.number === currentEpNum;
                return (
                  <button
                    key={ep.id}
                    onClick={() => goEpisode(ep)}
                    className={`border-base-100 hover:bg-base-150 flex w-full items-center justify-between border-b px-2 py-2 text-left transition-colors ${isCurrent ? 'bg-base-100' : ''}`}
                  >
                    <span
                      className={`mr-4 shrink-0 text-xs ${isCurrent ? 'text-base-900' : 'text-base-400'}`}
                    >
                      {unitPrefix}.{String(ep.number).padStart(3, '0')}
                    </span>
                    <span
                      className={`flex-1 truncate text-xs ${isCurrent ? 'text-base-750' : 'text-base-350'}`}
                    >
                      {ep.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {streams.length > 0 &&
        (streams.length > 2 ? (
          <SectionCollapsible label="Sources" count={streams.length} defaultOpen={true}>
            <div className="flex items-center justify-end pb-2">
              <DownloadButton provider={provider} unitId={unitId} language={lang} type="video" />
            </div>
            {streams.map((s, i) => {
              let displayUrl = s.sourceUrl;
              try {
                const u = new URL(s.sourceUrl);
                if (u.pathname === '/proxy' && u.searchParams.has('url')) {
                  const targetUrl = new URL(u.searchParams.get('url')!);
                  displayUrl = targetUrl.hostname;
                } else {
                  displayUrl = u.hostname;
                }
              } catch {}

              return (
                <div
                  key={i}
                  className={`group border-base-150 hover:bg-base-150 flex w-full items-start gap-3 border-b px-2 py-3 transition-colors ${i === activeIdx ? 'bg-base-100' : ''}`}
                >
                  <button
                    onClick={() => setActiveIdx(i)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span
                      className={`mt-0.5 shrink-0 text-xs ${i === activeIdx ? 'text-base-900' : 'text-base-350'}`}
                    >
                      {i === activeIdx ? '●' : '○'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-base-800 mb-1 text-xs">
                        Server {i + 1}
                        <span className="text-base-500 ml-2">
                          [{s.isHLS ? 'HLS' : 'MP4'}] {s.quality}
                          {s.language ? `  ${s.language}` : ''}
                        </span>
                      </div>
                      <div
                        className={`truncate text-xs ${i === activeIdx ? 'text-accent' : 'text-base-400 group-hover:text-base-500'}`}
                      >
                        {displayUrl}
                      </div>
                    </div>
                  </button>
                  <a
                    href={s.sourceUrl}
                    download={!s.isHLS}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      s.isHLS
                        ? 'Open HLS manifest (use downloadVideo() to save as MP4)'
                        : 'Download MP4'
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="text-base-350 hover:text-base-600 mt-0.5 shrink-0 text-xs transition-colors"
                  >
                    {s.isHLS ? '↗' : '↓'}
                  </a>
                </div>
              );
            })}
          </SectionCollapsible>
        ) : (
          <div className="border-base-200 border-t">
            <div className="flex items-center justify-between px-1 py-2">
              <span className="text-base-400 text-xs tracking-widest">
                SOURCES <span className="text-base-350">({streams.length})</span>
              </span>
              <DownloadButton provider={provider} unitId={unitId} language={lang} type="video" />
            </div>
            {streams.map((s, i) => {
              let displayUrl = s.sourceUrl;
              try {
                const u = new URL(s.sourceUrl);
                if (u.pathname === '/proxy' && u.searchParams.has('url')) {
                  const targetUrl = new URL(u.searchParams.get('url')!);
                  displayUrl = targetUrl.hostname;
                } else {
                  displayUrl = u.hostname;
                }
              } catch {}

              return (
                <div
                  key={i}
                  className={`group border-base-150 hover:bg-base-150 flex w-full items-start gap-3 border-b px-2 py-3 transition-colors ${i === activeIdx ? 'bg-base-100' : ''}`}
                >
                  <button
                    onClick={() => setActiveIdx(i)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span
                      className={`mt-0.5 shrink-0 text-xs ${i === activeIdx ? 'text-base-900' : 'text-base-350'}`}
                    >
                      {i === activeIdx ? '●' : '○'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-base-800 mb-1 text-xs">
                        Server {i + 1}
                        <span className="text-base-500 ml-2">
                          [{s.isHLS ? 'HLS' : 'MP4'}] {s.quality}
                          {s.language ? `  ${s.language}` : ''}
                        </span>
                      </div>
                      <div
                        className={`truncate text-xs ${i === activeIdx ? 'text-accent' : 'text-base-400 group-hover:text-base-500'}`}
                      >
                        {displayUrl}
                      </div>
                    </div>
                  </button>
                  <a
                    href={s.sourceUrl}
                    download={!s.isHLS}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      s.isHLS
                        ? 'Open HLS manifest (use downloadVideo() to save as MP4)'
                        : 'Download MP4'
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="text-base-350 hover:text-base-600 mt-0.5 shrink-0 text-xs transition-colors"
                  >
                    {s.isHLS ? '↗' : '↓'}
                  </a>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
