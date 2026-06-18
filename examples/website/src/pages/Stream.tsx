import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import * as api from '../api';
import { Combobox } from '../components/ui/Select';

function Player({ stream, langUI }: { stream: api.Stream; langUI?: React.ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<number>(stream.subtitles.length > 0 ? 0 : -1);
  const hlsRef = useRef<Hls | undefined>(undefined);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setPlayerError(null);

    let hls: Hls | undefined;
    if (stream.isHls) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayerError(`HLS error: ${d.details}`);
        });
        hls.loadSource(stream.url);
        hls.attachMedia(v);
        hlsRef.current = hls;
        v.play().catch(() => {});
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = stream.url;
        v.play().catch(() => {});
      } else {
        setPlayerError('HLS not supported in this browser');
      }
    } else {
      v.src = stream.url;
      v.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
      hlsRef.current = undefined;
      v.src = '';
    };
  }, [stream.url, stream.isHls]);

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
      {langUI}
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
      {stream.qualities.length > 1 && (
        <div className="border-base-200 mt-1 flex flex-wrap gap-2 border-t px-1 py-2">
          <span className="text-base-400 text-xs tracking-widest">QUALITY</span>
          {stream.qualities.map((q) => (
            <a
              key={q.label}
              href={q.url}
              target="_blank"
              rel="noreferrer"
              className="text-base-450 hover:text-base-700 text-xs"
            >
              {q.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
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

  // Episode id (opaque) is the only thing stored in the URL for video
  const episodeId = sp.get('epid') || '';
  // Chapter id for manga
  const chapterId = sp.get('chid') || '';
  // Title for display (optional)
  const title = sp.get('title') || '';
  // Media id to navigate back
  const mediaId = sp.get('mid') || '';

  const isManga = !!chapterId;
  const [lang, setLang] = useState<'sub' | 'dub' | 'raw'>('sub');

  const {
    data: streamData,
    isFetching: streamFetching,
    isError: streamError,
    error: streamErr,
  } = useQuery<api.Stream>({
    queryKey: ['stream', episodeId, lang],
    queryFn: () => api.episodeStream(episodeId, lang),
    enabled: !!episodeId,
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
  });

  const isFetching = streamFetching || pagesFetching;
  const isError = streamError || pagesError;
  const error = streamErr || pagesErr;

  const goAdjacentEpisode = (adj: { id: string; number: number }) => {
    navigate(
      `/stream?epid=${encodeURIComponent(adj.id)}&title=${encodeURIComponent(title)}&mid=${encodeURIComponent(mediaId)}`,
    );
  };

  const goAdjacentChapter = (adj: { id: string; number: number }) => {
    navigate(
      `/stream?chid=${encodeURIComponent(adj.id)}&title=${encodeURIComponent(title)}&mid=${encodeURIComponent(mediaId)}`,
    );
  };

  const adjacent = streamData?.adjacent ?? pagesData?.adjacent;
  const prev = adjacent?.prev;
  const next = adjacent?.next;

  const availableLangs: ('sub' | 'dub' | 'raw')[] = streamData ? [streamData.language] : ['sub'];

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
          <Player
            key={streamData.url}
            stream={streamData}
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

        {pagesData && <MangaReader pages={pagesData} />}
      </div>

      {/* Origin info (replaces proxy URL parsing) */}
      {streamData && (
        <div className="border-base-200 text-base-350 mt-2 flex items-center gap-2 border-t px-1 py-2 text-[10px]">
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
            onClick={() => prev && (isManga ? goAdjacentChapter(prev) : goAdjacentEpisode(prev))}
            className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
          >
            ← PREV {prev ? `(${isManga ? 'Ch' : 'EP'} ${prev.number})` : ''}
          </button>
          <button
            disabled={!next}
            onClick={() => next && (isManga ? goAdjacentChapter(next) : goAdjacentEpisode(next))}
            className="text-base-400 hover:text-base-700 disabled:text-base-300 text-xs transition-colors disabled:cursor-default"
          >
            NEXT {next ? `(${isManga ? 'Ch' : 'EP'} ${next.number})` : ''} →
          </button>
        </div>
      </div>
    </div>
  );
}
