import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';

function CursorIcon() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
      <path
        d="M2 1 L2 16 L5.5 12.5 L8 18.5 L10.5 17.5 L8 11.5 L13 11.5 Z"
        fill="white"
        stroke="#222"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ANIME_CARDS = [
  {
    title: "Frieren: Beyond Journey's End",
    ep: 28,
    desc: 'An elven mage reflects on her fleeting human companions after a grand adventure.',
    img: '/anime/frieren.jpg',
  },
  {
    title: 'Demon Slayer',
    ep: 44,
    desc: 'A boy joins the Demon Slayer Corps to avenge his slaughtered family.',
    img: '/anime/demon-slayer.jpg',
  },
  {
    title: 'Jujutsu Kaisen',
    ep: 48,
    desc: 'A student gains cursed energy after swallowing a powerful cursed finger.',
    img: '/anime/jujutsu-kaisen.jpg',
  },
  {
    title: 'Attack on Titan',
    ep: 87,
    desc: "Humanity's last stand behind walls against giant, man-eating Titans.",
    img: '/anime/attack-on-titan.jpg',
  },
  {
    title: 'One Piece',
    ep: 1100,
    desc: 'A pirate with rubber powers sets sail to find the legendary treasure, the One Piece.',
    img: '/anime/one-piece.jpg',
  },
  {
    title: 'My Hero Academia',
    ep: 138,
    desc: 'A quirkless boy trains under the greatest hero to inherit a world-saving power.',
    img: '/anime/my-hero-academia.jpg',
  },
];

export default function ProviderDashboardScene() {
  const [cards] = useState(() => [...ANIME_CARDS].sort(() => Math.random() - 0.5));
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: -40, y: -40 });
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    let idx = 0;
    const visit = () => {
      if (cancelled) return;
      const card = cardRefs.current[idx];
      if (card) {
        setCursorPos({
          x: card.offsetLeft + card.offsetWidth / 2,
          y: card.offsetTop + card.offsetHeight * 0.35,
        });
        setHoveredIdx(idx);
        idx = (idx + 1) % cards.length;
      }
    };
    const t = setTimeout(visit, 300);
    const id = setInterval(visit, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);

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
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#8b5cf6',
            display: 'inline-block',
          }}
        />
        <span style={{ color: '#e5e7eb', fontSize: 13.5, fontWeight: 600 }}>allmanga</span>
        <span
          style={{
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.22)',
            color: '#a78bfa',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          6 results
        </span>
        <span
          style={{
            marginLeft: 'auto',
            color: '#2d3748',
            fontSize: 11.5,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          search("frieren")
        </span>
      </div>
      <div
        ref={gridRef}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          padding: 14,
        }}
      >
        {cards.map((a, i) => (
          <div
            key={a.title}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            style={{
              borderRadius: 6,
              overflow: 'hidden',
              border: `1px solid ${hoveredIdx === i ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.07)'}`,
              transition: 'border-color 0.3s',
            }}
          >
            <div style={{ position: 'relative' }}>
              <img
                src={a.img}
                alt={a.title}
                style={{
                  width: '100%',
                  aspectRatio: '2/3',
                  objectFit: 'cover',
                  display: 'block',
                  opacity: hoveredIdx === i ? 0.15 : 0.6,
                  transition: 'opacity 0.3s',
                }}
              />
              <motion.div
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: '10px 9px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 55%)',
                }}
                animate={{ opacity: hoveredIdx === i ? 1 : 0 }}
                transition={{ duration: 0.25 }}
              >
                <div
                  style={{
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 3,
                    lineHeight: 1.3,
                  }}
                >
                  {a.title}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9.5, lineHeight: 1.4 }}>
                  {a.desc}
                </div>
              </motion.div>
            </div>
            <div style={{ padding: '7px 9px', background: '#111113' }}>
              <div
                style={{
                  color: hoveredIdx === i ? '#e5e7eb' : '#9ca3af',
                  fontSize: 11,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'color 0.3s',
                }}
              >
                {a.title}
              </div>
              <div
                style={{
                  color: '#374151',
                  fontSize: 10,
                  marginTop: 2,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {a.ep} eps
              </div>
            </div>
          </div>
        ))}
        <motion.div
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10 }}
          animate={{ x: cursorPos.x, y: cursorPos.y }}
          transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <CursorIcon />
        </motion.div>
      </div>
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11.5,
        }}
      >
        <span style={{ color: '#4b5563' }}>stream.url → </span>
        <span style={{ color: '#86efac' }}>https://cdn.example.com/frieren-ep1.m3u8</span>
      </div>
    </div>
  );
}
