import { useState, useEffect } from 'react';

const CODE_LINES: string[] = [
  `<span class="kw">import</span> <span class="pun">{</span> <span class="typ">createSdk</span> <span class="pun">}</span> <span class="kw">from</span> <span class="str">'anime-sdk'</span><span class="pun">;</span>`,
  ``,
  `<span class="kw">const</span> sdk <span class="pun">=</span> <span class="fn">createSdk</span><span class="pun">();</span> <span class="cm">// zero config</span>`,
  ``,
  `<span class="cm">// 1. Search for an anime title</span>`,
  `<span class="kw">const</span> <span class="pun">[</span>show<span class="pun">]</span> <span class="pun">=</span> <span class="kw">await</span> sdk<span class="pun">.</span><span class="fn">search</span><span class="pun">(</span><span class="str">'Frieren'</span><span class="pun">,</span> <span class="pun">{</span> kind<span class="pun">:</span> <span class="str">'anime'</span> <span class="pun">});</span>`,
  `<span class="cm">// → { title: { preferred: "Frieren: Beyond Journey's End" } }</span>`,
  ``,
  `<span class="cm">// 2. Fetch episode list</span>`,
  `<span class="kw">const</span> <span class="pun">{</span> items <span class="pun">}</span> <span class="pun">=</span> <span class="kw">await</span> sdk<span class="pun">.</span><span class="fn">episodes</span><span class="pun">(</span>show<span class="pun">);</span>`,
  `<span class="cm">// → [{ id: '...', number: 1, languages: ['sub', 'dub'] }, ...]</span>`,
  ``,
  `<span class="cm">// 3. Resolve a direct stream URL</span>`,
  `<span class="kw">const</span> stream <span class="pun">=</span> <span class="kw">await</span> sdk<span class="pun">.</span><span class="fn">stream</span><span class="pun">(</span>items<span class="pun">[</span><span class="num">0</span><span class="pun">],</span> <span class="pun">{</span> language<span class="pun">:</span> <span class="str">'sub'</span> <span class="pun">});</span>`,
  `<span class="cm">// → { url, origin, isHls, qualities, adjacent }</span>`,
  ``,
  `console<span class="pun">.</span><span class="fn">log</span><span class="pun">(</span>stream<span class="pun">.</span>url<span class="pun">);</span>`,
  `<span class="cm">// "https://cdn.example.com/frieren-ep1.m3u8"</span>`,
];

const CODE_LINES_PLAIN = CODE_LINES.map((l) => l.replace(/<[^>]+>/g, ''));

export default function CodeEditorScene() {
  const [revealedLines, setRevealedLines] = useState(0);
  const [typedChars, setTypedChars] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      while (!cancelled) {
        setRevealedLines(0);
        setTypedChars(0);
        for (let i = 0; i < CODE_LINES.length; i++) {
          if (cancelled) return;
          const plain = CODE_LINES_PLAIN[i];
          if (!plain) {
            await new Promise<void>((r) => setTimeout(r, 70));
            if (cancelled) return;
            setRevealedLines(i + 1);
            continue;
          }
          let chars = 0;
          while (chars < plain.length) {
            await new Promise<void>((r) => setTimeout(r, 38));
            if (cancelled) return;
            chars = Math.min(chars + 4, plain.length);
            setTypedChars(chars);
          }
          await new Promise<void>((r) => setTimeout(r, 55));
          if (cancelled) return;
          setRevealedLines(i + 1);
          setTypedChars(0);
        }
        await new Promise<void>((r) => setTimeout(r, 1400));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const typingLine = revealedLines < CODE_LINES.length ? CODE_LINES_PLAIN[revealedLines] : null;

  return (
    <div
      style={{
        width: '100%',
        background: '#0e0e10',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.09)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: '#161618',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
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
            color: '#4b5563',
            fontSize: 12.5,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          example.ts
        </span>
        <span
          style={{
            marginLeft: 'auto',
            color: '#2d3748',
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          TypeScript / anime-sdk
        </span>
      </div>
      <div
        style={{
          padding: '18px 0',
          lineHeight: 1.9,
          fontSize: 14,
          height: 420,
          overflow: 'hidden',
        }}
      >
        {CODE_LINES.slice(0, revealedLines).map((line, i) => (
          <div key={i} style={{ display: 'flex', minHeight: 27 }}>
            <span
              style={{
                minWidth: 54,
                textAlign: 'right',
                paddingRight: 24,
                color: '#2d3748',
                fontSize: 12,
                userSelect: 'none',
                lineHeight: '27px',
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            {line ? (
              <span style={{ color: '#9ca3af' }} dangerouslySetInnerHTML={{ __html: line }} />
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        ))}
        {typingLine != null && (
          <div style={{ display: 'flex', minHeight: 27 }}>
            <span
              style={{
                minWidth: 54,
                textAlign: 'right',
                paddingRight: 24,
                color: '#2d3748',
                fontSize: 12,
                userSelect: 'none',
                lineHeight: '27px',
                flexShrink: 0,
              }}
            >
              {revealedLines + 1}
            </span>
            <span style={{ color: '#9ca3af' }}>
              {typingLine.slice(0, typedChars)}
              <span style={{ borderLeft: '1.5px solid #6b7280', marginLeft: 1 }} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
