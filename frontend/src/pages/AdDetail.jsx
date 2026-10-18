import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import { useMeta } from '../useMeta';
import { viewWord } from '../plural';
import { shownViews } from '../views';
import { bumpHint } from '../bump';
import { CATEGORY_LABELS, KIND_LABELS, STATUS_LABELS, priceLabel, waLink } from '../ads';
import FavoriteButton from '../components/FavoriteButton';
import SafetyNote from '../components/SafetyNote';
import { SkeletonOrderDetail } from '../components/Skeleton';

// Фото: большое сверху и полоска миниатюр. Листать можно и стрелками —
// на телефоне миниатюры мелкие, а пальцем по стрелке попасть проще.
function Gallery({ photos, title }) {
  const [index, setIndex] = useState(0);
  if (photos.length === 0) return null;
  const current = photos[Math.min(index, photos.length - 1)];
  const go = (step) => setIndex((i) => (i + step + photos.length) % photos.length);
  return (
    <div className="ad-gallery">
      <div className="ad-gallery-main">
        <img src={current.url} alt={title} />
        {photos.length > 1 && (
          <>
            <button type="button" className="ad-gallery-arrow prev" onClick={() => go(-1)} aria-label="Предыдущее фото">
              ‹
            </button>
            <button type="button" className="ad-gallery-arrow next" onClick={() => go(1)} aria-label="Следующее фото">
              ›
            </button>
            <span className="ad-gallery-counter">
              {index + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="ad-gallery-thumbs">
          {photos.map((p, i) => (
            <button
              key={p.path}
              type="button"
              className={i === index ? 'active' : ''}
              onClick={() => setIndex(i)}
              aria-label={`Фото ${i + 1}`}
            >
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Действия автора. Удаление — через подтверждение: вместе с объявлением
// пропадают и фото, вернуть их нечем.
function OwnerPanel({ ad, onChange }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function step(name) {
    setBusy(true);
    setMessage('');
    try {
      const { ad: fresh } = await api.adStep(ad.id, name, token);
      onChange(fresh);
      if (name === 'bump') setMessage('Поднято — объявление снова в начале ленты');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Удалить объявление вместе с фото? Вернуть его будет нельзя.')) return;
    setBusy(true);
    try {
      await api.deleteAd(ad.id, token);
      navigate('/my-ads');
    } catch (e) {
      setMessage(e.message);
      setBusy(false);
    }
  }

  if (ad.status === 'removed') {
    return (
      <div className="ad-owner-panel">
        <p className="status-msg error">
          Объявление снято модератором по жалобе и в ленте не показывается. Его можно только удалить.
        </p>
        <button type="button" className="admin-btn-ghost" disabled={busy} onClick={remove}>
          Удалить
        </button>
      </div>
    );
  }

  const hint = ad.status === 'open' ? bumpHint(ad) : '';
  return (
    <div className="ad-owner-panel">
      <p className="ad-owner-title">Это ваше объявление</p>
      <div className="ad-owner-actions">
        <Link to={`/ads/${ad.id}/edit`} className="admin-btn-ghost">
          ✏️ Изменить
        </Link>
        {ad.status === 'open' ? (
          <>
            <button type="button" className="admin-btn-ghost" disabled={busy || !!hint} title={hint} onClick={() => step('bump')}>
              ⬆ Поднять
            </button>
            <button type="button" className="admin-btn-ghost" disabled={busy} onClick={() => step('close')}>
              Закрыть (продано, сдано)
            </button>
          </>
        ) : (
          <button type="button" className="admin-btn-ghost" disabled={busy} onClick={() => step('reopen')}>
            Открыть снова
          </button>
        )}
        <button type="button" className="admin-btn-ghost danger" disabled={busy} onClick={remove}>
          Удалить
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
      {message && <p className="hint">{message}</p>}
    </div>
  );
}

export default function AdDetail() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [ad, setAd] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  // Переход с одного объявления на другое (из избранного, по ссылке в
  // переписке) не размонтирует страницу — ответ по прежнему id не должен лечь
  // поверх нового.
  const currentId = useRef(id);

  useEffect(() => {
    currentId.current = id;
    setAd(null);
    setError('');
    api
      .ad(id, token)
      .then(({ ad }) => currentId.current === id && setAd(ad))
      .catch((e) => currentId.current === id && setError(e.message));
  }, [id, token]);

  useMeta(
    ad && `${ad.title} — Объявления Шабашки`,
    ad && `${KIND_LABELS[ad.kind]} · ${ad.city} · ${priceLabel(ad)} — ${ad.description}`.slice(0, 160)
  );

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSendError('');
    setSending(true);
    try {
      const { conversation } = await api.startAdConversation(ad.id, draft, token);
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleReport() {
    const reason = window.prompt('Опишите, что не так с этим объявлением:');
    if (!reason || !reason.trim()) return;
    try {
      await api.reportAd(ad.id, reason);
      setReportMsg('Жалоба отправлена — разберём в ближайшее время');
    } catch (err) {
      setReportMsg(err.message);
    }
    setTimeout(() => setReportMsg(''), 4000);
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: ad.title, url });
      } catch {
        // отменили — ничего не делаем
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMsg('Ссылка скопирована');
    setTimeout(() => setShareMsg(''), 2500);
  }

  if (error) {
    return (
      <p className="status-msg error">
        {error}. <Link to="/ads">Ко всем объявлениям</Link>
      </p>
    );
  }
  if (!ad) return <SkeletonOrderDetail />;

  const isOwner = user?.id === ad.user_id;
  const views = shownViews(ad, isOwner);
  // Из групп бот публикует от имени админа: имя и «Сообщения» привели бы к
  // админу, а не к автору. Остаётся WhatsApp — номер из самого поста.
  const imported = !!ad.is_imported;

  return (
    <div className="order-detail-wrap">
      <Link to="/ads" className="back-link">
        ← Ко всем объявлениям
      </Link>
      <div className="order-detail ad-detail">
        <Gallery photos={ad.photos} title={ad.title} />
        <div className="badges-row">
          <span className="badge">{KIND_LABELS[ad.kind]}</span>
          <span className="badge badge-format">{CATEGORY_LABELS[ad.category]}</span>
          {ad.status !== 'open' && <span className="badge status-closed">{STATUS_LABELS[ad.status]}</span>}
          <FavoriteButton type="ad" id={ad.id} className="order-detail-fav" />
        </div>
        <h1>{ad.title}</h1>
        <div className="budget-box">
          <span className="label">Цена</span>
          <span className="value">{priceLabel(ad)}</span>
        </div>
        <p className="meta">
          <span>
            📍 {ad.city}
            {ad.address ? `, ${ad.address}` : ''}
          </span>
          <span>🗓 {relativeDate(ad.bumped_at || ad.created_at)}</span>
          <span>👤 {imported ? 'Из открытых чатов' : ad.owner_name}</span>
          <span>
            👁 {views} {viewWord(views)}
          </span>
        </p>

        <h3 className="desc-heading">Описание</h3>
        <p className="description">{ad.description}</p>

        {isOwner ? (
          <OwnerPanel ad={ad} onChange={setAd} />
        ) : ad.status !== 'open' ? (
          <p className="status-msg">Автор закрыл это объявление — написать по нему уже нельзя.</p>
        ) : (
          <>
            {ad.whatsapp_phone && (
              <a className="whatsapp-btn" href={waLink(ad.whatsapp_phone, ad.title)} target="_blank" rel="noopener noreferrer">
                💬 Написать в WhatsApp
              </a>
            )}
            {imported ? (
              !ad.whatsapp_phone && (
                <p className="status-msg">Автор не оставил номера — связаться с ним не получится.</p>
              )
            ) : (
              <div className="apply-box">
                <h3>{ad.whatsapp_phone ? 'Или напишите прямо здесь' : 'Написать автору'}</h3>
                {user ? (
                  <form onSubmit={handleSend}>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      placeholder="Например: здравствуйте, ещё актуально? Можно посмотреть в субботу?"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {sendError && <p className="status-msg error">{sendError}</p>}
                    <button className="submit-btn" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? 'Отправляем…' : 'Отправить сообщение'}
                    </button>
                  </form>
                ) : (
                  <p className="apply-login-hint">
                    <Link to="/login" state={{ from: { pathname: `/ads/${ad.id}` } }}>
                      Войдите
                    </Link>{' '}
                    или <Link to="/register">зарегистрируйтесь</Link>, чтобы переписываться с автором на сайте.
                    {ad.whatsapp_phone ? ' Написать в WhatsApp можно и без аккаунта.' : ''}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <SafetyNote isImported={imported} />

        <div className="secondary-actions">
          <button type="button" onClick={handleShare}>
            🔗 {shareMsg || 'Поделиться'}
          </button>
          {!isOwner && (
            <button type="button" className="muted" onClick={handleReport}>
              ⚑ {reportMsg || 'Пожаловаться'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
