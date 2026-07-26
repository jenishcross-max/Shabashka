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

export function SkeletonOrderCard() {
  return (
    <div className="order-card skeleton-row">
      <div className="order-card-top">
        <div className="order-card-badges">
          <SkeletonBox width={70} height={20} style={{ borderRadius: 20 }} />
          <SkeletonBox width={80} height={20} style={{ borderRadius: 20 }} />
        </div>
        <SkeletonBox width={50} height={13} />
      </div>
      <SkeletonBox width="80%" height={18} style={{ marginTop: 12 }} />
      <SkeletonBox width="100%" height={13} style={{ marginTop: 10 }} />
      <SkeletonBox width="90%" height={13} style={{ marginTop: 6 }} />
      <div className="order-card-bottom" style={{ marginTop: 14 }}>
        <SkeletonBox width={90} height={14} />
        <SkeletonBox width={60} height={12} />
      </div>
    </div>
  );
}

export function SkeletonHomeCategoryTile() {
  return (
    <div className="category-tile skeleton-row">
      <SkeletonBox width={44} height={44} style={{ borderRadius: 12, flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <SkeletonBox width="70%" height={16} />
        <SkeletonBox width="45%" height={13} style={{ marginTop: 7 }} />
      </span>
    </div>
  );
}

export function SkeletonStatsBar() {
  return (
    <section className="stats-bar skeleton-row">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <SkeletonBox width="55%" height={32} style={{ margin: '0 auto' }} />
          <SkeletonBox width="70%" height={14} style={{ marginTop: 8 }} />
        </div>
      ))}
    </section>
  );
}

export function SkeletonCityPills({ count = 10 }) {
  return (
    <div className="city-pills skeleton-row">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} width={90 + ((i * 37) % 70)} height={40} style={{ borderRadius: 100 }} />
      ))}
    </div>
  );
}

export function SkeletonFilterList({ rows = 6 }) {
  return (
    <div className="filter-checkbox-list skeleton-row">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <SkeletonBox width={17} height={17} style={{ borderRadius: 4, flex: 'none' }} />
          <SkeletonBox width={`${55 + ((i * 13) % 35)}%`} height={13} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonOrderDetail() {
  return (
    <div className="order-detail-wrap">
      <SkeletonBox width={140} height={14} />
      <div className="order-detail skeleton-row">
        <div className="badges-row">
          <SkeletonBox width={90} height={22} style={{ borderRadius: 20 }} />
          <SkeletonBox width={80} height={22} style={{ borderRadius: 20 }} />
        </div>
        <SkeletonBox width="65%" height={28} style={{ marginTop: 16 }} />
        <SkeletonBox width="90%" height={14} style={{ marginTop: 18 }} />
        <SkeletonBox width="70%" height={14} style={{ marginTop: 8 }} />
        <SkeletonBox width="100%" height={64} style={{ marginTop: 20, borderRadius: 12 }} />
        <SkeletonBox width="40%" height={16} style={{ marginTop: 24 }} />
        <SkeletonBox width="100%" height={13} style={{ marginTop: 10 }} />
        <SkeletonBox width="100%" height={13} style={{ marginTop: 6 }} />
        <SkeletonBox width="80%" height={13} style={{ marginTop: 6 }} />
        <SkeletonBox width={220} height={44} style={{ marginTop: 24, borderRadius: 8 }} />
      </div>
    </div>
  );
}

export function SkeletonMyOrderRow() {
  return (
    <div className="my-order-row skeleton-row">
      <div>
        <SkeletonBox width={220} height={16} />
        <SkeletonBox width={260} height={12} style={{ marginTop: 8 }} />
      </div>
      <div className="my-order-actions">
        <SkeletonBox width={70} height={14} />
        <SkeletonBox width={70} height={14} />
        <SkeletonBox width={70} height={14} />
      </div>
    </div>
  );
}

export function SkeletonConversationRow() {
  return (
    <div className="conversation-row skeleton-row">
      <div className="conversation-main">
        <div className="conversation-top">
          <SkeletonBox width={130} height={14} />
          <SkeletonBox width={60} height={12} />
        </div>
        <SkeletonBox width="45%" height={12} style={{ marginTop: 8 }} />
        <SkeletonBox width="75%" height={12} style={{ marginTop: 6 }} />
      </div>
    </div>
  );
}

export function SkeletonMessageBubble({ mine = false }) {
  return (
    <div className={`message-bubble${mine ? ' mine' : ''} skeleton-row`}>
      <SkeletonBox width={Math.random() > 0.5 ? 180 : 120} height={14} />
      <SkeletonBox width={50} height={10} style={{ marginTop: 8 }} />
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div style={{ padding: '40px 0' }}>
      <SkeletonBox width="30%" height={26} />
      <SkeletonBox width="100%" height={14} style={{ marginTop: 20 }} />
      <SkeletonBox width="90%" height={14} style={{ marginTop: 10 }} />
      <SkeletonBox width="80%" height={14} style={{ marginTop: 10 }} />
    </div>
  );
}

export function SkeletonForm({ fields = 5 }) {
  return (
    <div className="form-card wide skeleton-row">
      <div className="card-header">
        <SkeletonBox width={100} height={24} />
        <SkeletonBox width={140} height={13} />
      </div>
      <div className="card-body">
        <SkeletonBox width="35%" height={22} />
        <SkeletonBox width="25%" height={13} style={{ marginTop: 10 }} />
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} style={{ marginTop: 22 }}>
            <SkeletonBox width="30%" height={12} />
            <SkeletonBox width="100%" height={40} style={{ marginTop: 8, borderRadius: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
