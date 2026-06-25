import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import * as api from '../api';
import { Combobox } from '../components/ui/Select';
import { Button } from '../components/ui/Button';

function Player({
  stream,
  activeUrl,
  isHls,
}: {
  stream: api.Stream;
  activeUrl: string;
  isHls: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<number>(stream.subtitles.length > 0 ? 0 : -1);
  const hlsRef = useRef<Hls | undefined>(undefined);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setPlayerError(null);

    let hls: Hls | undefined;
    if (isHls) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayerError(`HLS error: ${d.details}`);
        });
        hls.loadSource(activeUrl);
        hls.attachMedia(v);
        hlsRef.current = hls;
        v.play().catch(() => {});
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = activeUrl;
        v.play().catch(() => {});
      } else {
        setPlayerError('HLS not supported in this browser');
      }
    } else {
      v.src = activeUrl;
      v.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
      hlsRef.current = undefined;
      v.src = '';
    };
  }, [activeUrl, isHls]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const textTracks = v.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      textTracks[i].mode = activeSub === i ? 'showing' : 'disabled';
    }
  }, [activeSub]);

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
        {stream.subtitles.map((s, i) => (
          <track key={i} kind="subtitles" src={s.url} srcLang={s.language} label={s.label} />
        ))}
      </video>
      {stream.subtitles.length > 0 && (
        <div className="border-base-200 flex items-center gap-2 border-t px-1 py-2">
          <span className="text-base-400 text-xs tracking-widest">SUB</span>
          <Combobox
            value={String(activeSub)}
            onValueChange={(v) => setActiveSub(Number(v))}
            options={[
              { value: '-1', label: 'off' },
              ...stream.subtitles.map((s, i) => ({ value: String(i), label: s.label })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

interface DownloadProgress {
  active: boolean;
  phase?: string;
  detail?: string;
  downloaded?: number;
  total?: number;
  error?: string;
}

function VideoDownloadButton({
  episodeId,
  language,
  filename,
}: {
  episodeId: string;
  language: api.Language;
  filename: string;
}) {
  const [progress, setProgress] = useState<DownloadProgress>({ active: false });
  const handleRef = useRef<api.DownloadHandle | null>(null);

  useEffect(() => () => handleRef.current?.close(), []);

  const start = () => {
    setProgress({ active: true, phase: 'starting' });
    handleRef.current = api.watchVideoDownload(episodeId, language, {
      onProgress: ({ phase, detail }) => setProgress({ active: true, phase, detail }),
      onComplete: (token) => {
        setProgress({ active: false });
        triggerDownload(api.downloadFileUrl('video', token), `${filename}.mp4`);
      },
      onError: (msg) => setProgress({ active: false, error: msg }),
    });
  };

  if (progress.active) {
    return (
      <div className="text-base-450 flex items-center gap-2 text-[10px]">
        <span className="tracking-widest">DOWNLOADING</span>
        <span className="text-base-350">
          {progress.phase}
          {progress.detail ? ` · ${progress.detail.slice(0, 60)}` : ''}
        </span>
        <button
          onClick={() => {
            handleRef.current?.close();
            setProgress({ active: false });
          }}
          className="text-base-400 hover:text-base-700 transition-colors"
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={start} variant="outline" className="px-3 py-1 text-[10px]">
        DOWNLOAD MP4
      </Button>
      {progress.error && (
        <span className="text-[10px] text-red-900">{progress.error.slice(0, 80)}</span>
      )}
    </div>
  );
}

function ChapterDownloadButton({ chapterId, filename }: { chapterId: string; filename: string }) {
  const [progress, setProgress] = useState<DownloadProgress>({ active: false });
  const handleRef = useRef<api.DownloadHandle | null>(null);

  useEffect(() => () => handleRef.current?.close(), []);

  const start = () => {
    setProgress({ active: true, downloaded: 0, total: 0 });
    handleRef.current = api.watchChapterDownload(chapterId, {
      onProgress: ({ downloaded, total }) => setProgress({ active: true, downloaded, total }),
      onComplete: (token) => {
        setProgress({ active: false });
        triggerDownload(api.downloadFileUrl('manga-chapter', token), `${filename}.zip`);
      },
      onError: (msg) => setProgress({ active: false, error: msg }),
    });
  };

  if (progress.active) {
    const total = progress.total ?? 0;
    const done = progress.downloaded ?? 0;
    return (
      <div className="text-base-450 flex items-center gap-2 text-[10px]">
        <span className="tracking-widest">DOWNLOADING</span>
        <span className="text-base-350">
          {done}/{total > 0 ? total : '?'} pages
        </span>
        <button
          onClick={() => {
            handleRef.current?.close();
            setProgress({ active: false });
          }}
          className="text-base-400 hover:text-base-700 transition-colors"
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={start} variant="outline" className="px-3 py-1 text-[10px]">
        DOWNLOAD ZIP
      </Button>
      {progress.error && (
        <span className="text-[10px] text-red-900">{progress.error.slice(0, 80)}</span>
      )}
    </div>
  );
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function MangaReader({ pages }: { pages: api.Pages }) {
  return (
    <div className="bg-base-0 mb-4 flex flex-col items-center gap-4">
      {pages.pages.map((p, i) => (
        <img
          key={i}
          src={p.url}
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

  const episodeId = sp.get('epid') || '';
  const chapterId = sp.get('chid') || '';
  const title = sp.get('title') || '';
  const mediaId = sp.get('mid') || '';

  // Languages threaded from Episodes.tsx — defaults to ['sub'] when missing
  // (e.g. opened via a direct link).
  const langsParam = sp.get('langs');
  const availableLangs: api.Language[] = langsParam
    ? (langsParam
        .split(',')
        .filter((l) => l === 'sub' || l === 'dub' || l === 'raw') as api.Language[])
    : ['sub'];

  const isManga = !!chapterId;
  const [lang, setLang] = useState<api.Language>(availableLangs[0] ?? 'sub');
  const [activeQuality, setActiveQuality] = useState<string | null>(null); // label, e.g. '1080p'

  const {
    data: streamData,
    isFetching: streamFetching,
    isError: streamError,
    error: streamErr,
  } = useQuery<api.Stream>({
    queryKey: ['stream', episodeId, lang],
    queryFn: () => api.episodeStream(episodeId, lang),
    enabled: !!episodeId,
    // Stream URLs carry signed expiries; never serve stale data, and don't
    // keep the resolved URL hanging around in cache after the player unmounts.
    staleTime: 0,
    gcTime: 30_000,
    retry: 0,
  });

  const {
    data: pagesData,
    isFetching: pagesFetching,
    isError: pagesError,
    error: pagesErr,
  } = useQuery<api.Pages>({
    queryKey: ['pages', chapterId],
    queryFn: () => api.chapterPages(chapterId),
    enabled: !!chapterId,
    staleTime: 0,
    gcTime: 30_000,
    retry: 0,
  });

  // Reset quality selection when stream changes.
  useEffect(() => {
    setActiveQuality(null);
  }, [streamData?.url]);

  const isFetching = streamFetching || pagesFetching;
  const isError = streamError || pagesError;
  const error = streamErr || pagesErr;

  const goAdjacent = (adj: { id: string; number: number }) => {
    if (isManga) {
      navigate(
        `/stream?chid=${encodeURIComponent(adj.id)}&title=${encodeURIComponent(title)}&mid=${encodeURIComponent(mediaId)}`,
      );
    } else {
      const params = new URLSearchParams({
        epid: adj.id,
        title,
        mid: mediaId,
      });
      if (langsParam) params.set('langs', langsParam);
      navigate(`/stream?${params.toString()}`);
    }
  };

  const adjacent = streamData?.adjacent ?? pagesData?.adjacent;
  const prev = adjacent?.prev;
  const next = adjacent?.next;

  // Active playable URL — quality switch is client-side: pick from stream.qualities[].
  const activePick = streamData
    ? (streamData.qualities.find((q) => q.label === activeQuality) ?? {
        label: 'auto' as const,
        url: streamData.url,
      })
    : null;
  const activeUrl = activePick?.url ?? streamData?.url ?? '';
  // HLS-ness of the active URL: if the selected variant has a different URL,
  // re-detect from the extension. Saves a separate isHls per quality.
  const activeIsHls = streamData
    ? activePick && activePick.url !== streamData.url
      ? /\.m3u8(\?|$)/i.test(activePick.url)
      : streamData.isHls
    : false;

  const filename = `${(title || 'episode').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)}_${
    isManga ? 'chapter' : 'episode'
  }`;

  return (
    <div className="px-4">
      {mediaId && (
        <div className="text-base-400 mt-4 flex items-center gap-2 text-[10px]">
          <Link
            to={`/media?id=${encodeURIComponent(mediaId)}`}
            className="hover:text-base-600 transition-colors"
          >
            ← {title || 'back'}
          </Link>
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

        {streamData && (
          <Player key={activeUrl} stream={streamData} activeUrl={activeUrl} isHls={activeIsHls} />
        )}

        {/* Manga chapter controls live above the reader so they aren't
            buried under hundreds of scrolling pages. */}
        {pagesData && (
          <div className="border-base-200 mb-3 flex items-center gap-3 border-y px-1 py-2">
            <span className="text-base-400 text-[10px] tracking-widest">
              {pagesData.pages.length} pages
            </span>
            <div className="ml-auto">
              <ChapterDownloadButton chapterId={chapterId} filename={filename} />
            </div>
          </div>
        )}

        {pagesData && <MangaReader pages={pagesData} />}
      </div>

      {/* Stream controls: language + quality + download */}
      {streamData && (
        <div className="border-base-200 mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-1 py-2">
          {availableLangs.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-base-400 text-[10px] tracking-widest">LANG</span>
              {availableLangs.map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`text-xs tracking-widest uppercase transition-colors ${
                    lang === l ? 'text-base-900' : 'text-base-400 hover:text-base-700'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          {streamData.qualities.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-base-400 text-[10px] tracking-widest">QUALITY</span>
              {streamData.qualities.map((q) => (
                <button
                  key={q.label}
                  onClick={() => setActiveQuality(q.label)}
                  className={`text-xs tracking-widest uppercase transition-colors ${
                    (activeQuality ?? streamData.qualities[0].label) === q.label
                      ? 'text-base-900'
                      : 'text-base-400 hover:text-base-700'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto">
            <VideoDownloadButton episodeId={episodeId} language={lang} filename={filename} />
          </div>
        </div>
      )}

      {/* Origin info */}
      {streamData && (
        <div className="border-base-200 text-base-350 mt-0 flex items-center gap-2 border-t px-1 py-2 text-[10px]">
          <span>SOURCE</span>
          <span className="text-base-400">{streamData.origin.host}</span>
          {streamData.origin.proxied && <span className="text-base-300">· proxied</span>}
        </div>
      )}

      {/* Prev / Next navigation from adjacent */}
      <div className="border-base-200 mt-2 mb-0 border-t">
        <div className="flex items-center justify-end gap-3 px-1 py-2">
          <button
            disabled={!prev}
            onClick={() => prev && goAdjacent(prev)}
            className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
          >
            ← PREV {prev ? `(${isManga ? 'Ch' : 'EP'} ${prev.number})` : ''}
          </button>
          <button
            disabled={!next}
            onClick={() => next && goAdjacent(next)}
            className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
          >
            NEXT {next ? `(${isManga ? 'Ch' : 'EP'} ${next.number})` : ''} →
          </button>
        </div>
      </div>
    </div>
  );
}
