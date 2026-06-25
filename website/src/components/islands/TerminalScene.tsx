import { useState, useEffect } from 'react';

type TLine =
  | { t: 'blank' }
  | { t: 'cmd'; v: string }
  | { t: 'file'; v: string }
  | { t: 'pass'; v: string; time: string }
  | { t: 'ok'; v: string };

const TERMINAL_LINES: TLine[] = [
  { t: 'cmd', v: 'npx vitest run tests/e2e --reporter=verbose' },
  { t: 'blank' },
  { t: 'file', v: 'RUNNING  tests/e2e/allmanga.test.ts' },
  { t: 'pass', v: 'search("Frieren") → Media[]', time: '3.2s' },
  { t: 'pass', v: 'episodes() → 28 Episode items', time: '1.8s' },
  { t: 'pass', v: 'stream() → HLS url', time: '2.1s' },
  { t: 'pass', v: 'ffmpeg screenshot → 45.2 KB', time: '4.4s' },
  { t: 'blank' },
  { t: 'file', v: 'RUNNING  tests/e2e/gogoanime.test.ts' },
  { t: 'pass', v: 'search("One Piece") → Media[]', time: '4.1s' },
  { t: 'pass', v: 'stream() → HLS url', time: '3.3s' },
  { t: 'pass', v: 'ffmpeg screenshot → 23.1 KB', time: '5.2s' },
  { t: 'blank' },
  { t: 'file', v: 'RUNNING  tests/e2e/goyabu.test.ts' },
  { t: 'pass', v: 'search("Naruto") → Media[]', time: '2.9s' },
  { t: 'pass', v: 'stream() → MP4 url', time: '1.4s' },
  { t: 'pass', v: 'ffmpeg screenshot → 31.7 KB', time: '3.8s' },
  { t: 'blank' },
  { t: 'ok', v: 'Tests:  9 passed  ·  9 total  ·  Duration: 31.3s' },
];

export default function TerminalScene() {
  const [revealed, setRevealed] = useState(0);
  const [activeTimer, setActiveTimer] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      while (!cancelled) {
        setRevealed(0);
        setActiveTimer(null);
        for (let i = 0; i < TERMINAL_LINES.length; i++) {
          if (cancelled) return;
          const line = TERMINAL_LINES[i];
          if (line.t === 'pass') {
            const targetMs = parseFloat(line.time) * 1000;
            const duration = 420;
            const start = performance.now();
            await new Promise<void>((resolve) => {
              const tick = (now: number) => {
                if (cancelled) {
                  resolve();
                  return;
                }
                const p = Math.min((now - start) / duration, 1);
                setActiveTimer(p * targetMs);
                if (p < 1) requestAnimationFrame(tick);
                else resolve();
              };
              requestAnimationFrame(tick);
            });
            if (cancelled) return;
            setActiveTimer(null);
            setRevealed(i + 1);
          } else {
            await new Promise<void>((r) => setTimeout(r, line.t === 'blank' ? 60 : 140));
            if (cancelled) return;
            setRevealed(i + 1);
          }
        }
        await new Promise<void>((r) => setTimeout(r, 1800));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const runningLine = activeTimer !== null ? TERMINAL_LINES[revealed] : null;

  return (
    <div
      style={{
        width: '100%',
        background: '#080810',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: '#111114',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '11px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        {(['#ff5f57', '#febc2e', '#28c840'] as const).map((c) => (
          <span
            key={c}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: c,
              display: 'inline-block',
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 14,
            color: '#374151',
            fontSize: 12.5,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          Terminal / zsh
        </span>
      </div>
      <div
        style={{
          padding: '22px 28px',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13.5,
          lineHeight: 2,
          height: 420,
          overflow: 'hidden',
        }}
      >
        {TERMINAL_LINES.slice(0, revealed).map((line, i) => {
          if (line.t === 'blank') return <div key={i} style={{ height: 10 }} />;
          if (line.t === 'cmd')
            return (
              <div key={i} style={{ color: '#c4c4c4', marginBottom: 6 }}>
                <span style={{ color: '#8b5cf6' }}>❯ </span>
                {line.v}
              </div>
            );
          if (line.t === 'file')
            return (
              <div key={i} style={{ color: '#4b5563', fontSize: 12, letterSpacing: '0.02em' }}>
                {line.v}
              </div>
            );
          if (line.t === 'pass')
            return (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: 'space-between', color: '#d1d5db' }}
              >
                <span>
                  <span style={{ color: '#4ade80' }}> ✓ </span>
                  {line.v}
                </span>
                <span style={{ color: '#374151' }}>{line.time}</span>
              </div>
            );
          if (line.t === 'ok')
            return (
              <div
                key={i}
                style={{
                  color: '#4ade80',
                  fontWeight: 600,
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  paddingTop: 14,
                  marginTop: 4,
                }}
              >
                {line.v}
              </div>
            );
          return null;
        })}
        {runningLine?.t === 'pass' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280' }}>
            <span>
              <span style={{ color: '#374151' }}> · </span>
              {runningLine.v}
            </span>
            <span style={{ color: '#4b5563' }}>{(activeTimer! / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>
    </div>
  );
}
