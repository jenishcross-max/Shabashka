export default function Logo({ size = 'md', onDark = false }) {
  const dims = size === 'sm' ? { box: 34, title: 19, sub: 9 } : { box: 40, title: 23, sub: 10.5 };

  return (
    <div className="logo-mark-wrap">
      <svg
        className="logo-mark"
        width={dims.box}
        height={dims.box}
        viewBox="0 0 100 100"
        role="img"
        aria-label="Шабашка"
      >
        <rect x="2" y="2" width="96" height="96" rx="23" fill="var(--red)" />
        <g fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 32 V60 a10 10 0 0 0 20 0 V32" />
          <path d="M50 32 V60 a10 10 0 0 0 20 0 V32" />
        </g>
      </svg>
      <div className="logo-text">
        <div className={`logo-title${onDark ? ' logo-title-light' : ''}`} style={{ fontSize: dims.title }}>
          Шабашка
        </div>
        <div className="logo-subtitle" style={{ fontSize: dims.sub }}>КЫРГЫЗСТАН · KG</div>
      </div>
    </div>
  );
}
