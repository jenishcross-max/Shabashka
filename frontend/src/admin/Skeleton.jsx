export function SkeletonBox({ width, height = 14, style }) {
  return <span className="skeleton-box" style={{ width, height, ...style }} />;
}

export function SkeletonTableRows({ columns, rows = 6, className = '' }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div className={`admin-table-row skeleton-row ${className}`} key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <SkeletonBox key={c} width={c === columns - 1 ? '70%' : undefined} />
          ))}
        </div>
      ))}
    </>
  );
}

export function SkeletonStatCards({ count = 5 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div className="admin-stat-card" key={i}>
          <SkeletonBox width="65%" height={12} />
          <SkeletonBox width="45%" height={26} style={{ marginTop: 10 }} />
        </div>
      ))}
    </>
  );
}

export function SkeletonComplaint() {
  return (
    <div className="admin-complaint">
      <div className="admin-complaint-text">
        <SkeletonBox width="70%" height={15} />
        <SkeletonBox width="35%" height={12} style={{ marginTop: 8 }} />
      </div>
      <div className="admin-complaint-actions">
        <SkeletonBox width={90} height={32} />
        <SkeletonBox width={90} height={32} />
      </div>
    </div>
  );
}

export function SkeletonCategoryTile() {
  return (
    <div className="category-tile admin-category-tile">
      <SkeletonBox width={28} height={28} style={{ borderRadius: '50%' }} />
      <span>
        <SkeletonBox width="60%" height={14} />
        <SkeletonBox width="40%" height={12} style={{ marginTop: 6 }} />
      </span>
    </div>
  );
}
