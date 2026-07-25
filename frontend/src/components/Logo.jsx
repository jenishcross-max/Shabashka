export default function Logo({ size = 'md', onDark = false }) {
  const dims = size === 'sm' ? { box: 34, ring: 12, title: 19, sub: 9 } : { box: 40, ring: 15, title: 23, sub: 10.5 };

  return (
    <div className="logo-mark-wrap">
      <div className="logo-mark" style={{ width: dims.box, height: dims.box }}>
        <div className="logo-mark-ring" style={{ width: dims.ring, height: dims.ring }} />
        <div className="logo-mark-inset" />
      </div>
      <div className="logo-text">
        <div className={`logo-title${onDark ? ' logo-title-light' : ''}`} style={{ fontSize: dims.title }}>
          Шабашка
        </div>
        <div className="logo-subtitle" style={{ fontSize: dims.sub }}>КЫРГЫЗСТАН · KG</div>
      </div>
    </div>
  );
}
