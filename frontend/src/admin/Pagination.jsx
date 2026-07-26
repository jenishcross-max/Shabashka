export default function Pagination({ page, pages, total, onChange }) {
  if (pages <= 1) return null;

  return (
    <div className="admin-pagination">
      <button className="admin-btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Назад
      </button>
      <span className="admin-subtitle">
        Стр. {page} из {pages} · всего {total}
      </span>
      <button className="admin-btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Вперёд →
      </button>
    </div>
  );
}
