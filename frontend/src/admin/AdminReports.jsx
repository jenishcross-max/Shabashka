import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { SkeletonComplaint } from '../components/Skeleton';

const TYPE_LABELS = { order: 'Заказ', vacancy: 'Вакансия', board: 'Доска' };
const TYPE_PATHS = { order: 'orders', vacancy: 'vacancies' };

// Что именно делает «скрыть» — зависит от типа: заказ и вакансию закрываем,
// записку на доске скрываем. Само объявление при этом не удаляется: на него есть
// жалоба, и оно само себе доказательство.
const HIDE_LABELS = { order: 'Закрыть заказ', vacancy: 'Закрыть вакансию', board: 'Скрыть с доски' };

// Заголовок объявления. Живое читаем из базы, от удалённого остаётся только
// снимок, снятый в момент жалобы, — иначе после «скрыть» в списке была бы пустая
// строка без всякого следа того, на что жаловались.
function titleOf(report) {
  if (report.listing_title) return report.listing_title;
  const snap = report.snapshot || {};
  return snap.title || snap.text || 'без названия';
}

export default function AdminReports() {
  const { token } = useAuth();
  const [reports, setReports] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminReports(token, showAll ? 'all' : 'open')
      .then(({ reports }) => setReports(reports))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, showAll]);

  async function resolve(id, action) {
    await api.adminResolveReport(id, action, token);
    load();
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Жалобы на модерации</h1>
        <button className="admin-btn-ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Только открытые' : 'Показать все'}
        </button>
      </div>
      {!loading && reports.length === 0 && <p className="status-msg">Жалоб нет.</p>}
      <div className="admin-complaints">
        {loading && (
          <>
            <SkeletonComplaint />
            <SkeletonComplaint />
            <SkeletonComplaint />
          </>
        )}
        {!loading &&
          reports.map((r) => {
            const title = titleOf(r);
            const path =
              r.listing_type === 'board'
                ? `/board#p${r.listing_id}`
                : `/${TYPE_PATHS[r.listing_type]}/${r.listing_id}`;

            return (
              <div key={r.id} className={`admin-complaint${r.resolved ? ' resolved' : ''}`}>
                <div className="admin-complaint-text">
                  <div className="strong">
                    {TYPE_LABELS[r.listing_type] || r.listing_type} «
                    {r.listing_alive ? <Link to={path}>{title}</Link> : title}» — {r.reason}
                  </div>
                  <div className="admin-subtitle">
                    {new Date(r.created_at).toLocaleString('ru-RU')}
                    {!r.listing_alive && ' · объявления уже нет — ниже копия из жалобы'}
                    {r.listing_status === 'closed' && ' · закрыто'}
                    {!!r.board_hidden && ' · скрыто'}
                    {r.resolved && ' · решено'}
                  </div>
                </div>
                {!r.resolved && (
                  <div className="admin-complaint-actions">
                    {r.listing_alive && (
                      <button className="admin-btn-danger" onClick={() => resolve(r.id, 'hide')}>
                        {HIDE_LABELS[r.listing_type] || 'Скрыть'}
                      </button>
                    )}
                    <button className="admin-btn-ghost" onClick={() => resolve(r.id, 'dismiss')}>
                      {r.listing_alive ? 'Отклонить' : 'Закрыть жалобу'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
