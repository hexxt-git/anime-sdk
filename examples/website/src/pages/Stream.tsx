import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
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

  const isManga = !!chapterId;

  // Progressive streams — arrive from all sources as SSE events
  const [streams, setStreams] = useState<api.Stream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const subStreams = streams.filter((s) => s.language === 'sub');
  const dubStreams = streams.filter((s) => s.language === 'dub');
  const rawStreams = streams.filter((s) => s.language === 'raw');
  const activeStream = activeIdx != null ? streams[activeIdx] : (subStreams[0] ?? streams[0]);

  // Reset when episode changes
  useEffect(() => {
    if (!episodeId) return;
    setStreams([]);
    setStreamsLoading(true);
    setStreamsError(null);
    setActiveIdx(null);

    const handle = api.episodeStreams(
      episodeId,
      mediaId || undefined,
      (s) => {
        setStreams((prev) => [...prev, s]);
      },
      () => setStreamsLoading(false),
      (e) => {
        setStreamsError(e);
        setStreamsLoading(false);
      },
    );
    return () => handle.close();
  }, [episodeId, mediaId]);

  const [pagesData, setPagesData] = useState<api.Pages | null>(null);
  const [pagesFetching, setPagesFetching] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);

  useEffect(() => {
    if (!chapterId) return;
    setPagesFetching(true);
    api
      .chapterPages(chapterId)
      .then((p) => {
        setPagesData(p);
        setPagesFetching(false);
      })
      .catch((e) => {
        setPagesError(String(e));
        setPagesFetching(false);
      });
  }, [chapterId]);

  const activeUrl = activeStream?.url ?? '';
  const activeIsHls = activeStream?.isHls ?? false;

  const isFetching = streamsLoading || pagesFetching;
  const isError = !!streamsError || !!pagesError;
  const error = streamsError || pagesError;

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
        {isFetching && !activeStream && (
          <div className="border-base-200 bg-base-100 flex aspect-video items-center justify-center border">
            <p className="text-base-350 text-xs tracking-widest">
              resolving {isManga ? 'pages' : 'streams'}...
            </p>
          </div>
        )}
        {isError && !activeStream && (
          <div className="border-base-200 bg-base-100 flex aspect-video items-center justify-center border">
            <p className="text-xs text-red-900">{String(error)}</p>
          </div>
        )}

        {activeStream && (
          <Player key={activeUrl} stream={activeStream} activeUrl={activeUrl} isHls={activeIsHls} />
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

      {/* Stream picker: one row per language */}
      {streams.length > 0 && (
        <div className="border-base-100 mt-2 divide-y border-t">
          {(
            [
              { label: 'SUB', rows: subStreams },
              { label: 'DUB', rows: dubStreams },
              { label: 'RAW', rows: rawStreams },
            ] as const
          ).map(({ label, rows }) =>
            rows.length === 0 ? null : (
              <div key={label} className="flex items-center gap-4 px-1 py-2">
                <span className="text-base-300 w-8 shrink-0 text-[10px] tracking-widest">
                  {label}
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {rows.map((s, i) => {
                    const idx = streams.indexOf(s);
                    const active = s === activeStream;
                    return (
                      <button
                        key={`${s.source}-${s.server}-${i}`}
                        onClick={() => setActiveIdx(idx)}
                        className={`text-xs tracking-widest uppercase transition-colors ${
                          active ? 'text-base-900' : 'text-base-400 hover:text-base-600'
                        }`}
                      >
                        {s.source}·{s.server} {s.quality !== 'auto' ? s.quality : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ),
          )}

          {activeStream && (
            <div className="flex flex-wrap items-center gap-4 px-1 py-2">
              <div className="text-base-350 text-[10px]">
                {activeStream.source} · {activeStream.server} · {activeStream.quality}
              </div>
              <div className="ml-auto">
                <VideoDownloadButton
                  episodeId={episodeId}
                  language={activeStream.language}
                  filename={filename}
                />
              </div>
            </div>
          )}

          {streamsLoading && (
            <div className="px-1 py-1">
              <span className="text-base-300 text-[10px] tracking-widest">loading…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
