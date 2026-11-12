import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { useAuth } from '../context/AuthContext';
import { employmentLabel } from '../employmentTypes';
import { experienceLabel } from '../experienceLevels';
import VacancyCard, { formatSalary } from '../components/VacancyCard';
import FavoriteButton from '../components/FavoriteButton';
import FormatIcon from '../components/FormatIcon';
import SafetyNote from '../components/SafetyNote';
import SubscribeButton from '../components/SubscribeButton';
import { SkeletonOrderDetail } from '../components/Skeleton';
import { useMeta, useJsonLd } from '../useMeta';
import { viewWord } from '../plural';
import { shownViews } from '../views';
import { landingForCategory, landingPath } from '../landings';
import { StudentBadge } from '../components/StudentField';
import { salaryUnit, JUNK_BELOW } from '../salary';
import { trackContact, telLink } from '../contact';

// schema.org JobPosting ожидает свои значения employmentType, а не наши внутренние коды.
const SCHEMA_EMPLOYMENT_TYPE = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  shift: 'OTHER',
  // Разовая работа — временная (как в backend/src/meta.js).
  gig: 'TEMPORARY',
  internship: 'INTERN',
};

// Вакансию из чата бот публикует от имени админа: его имя у всех них было
// «работодателем» — и на карточке, и для Google. Настоящего имени у нас нет
// (аудит 12 ноября 2026, см. docs/research) — пишем честно, как в meta.js.
const IMPORTED_EMPLOYER = 'Частный работодатель';
const salaryOf = (value) => (Number(value) >= JUNK_BELOW ? Number(value) : null);

// Столько живёт вакансия из чата: как VACANCY_DAYS в backend/src/staleListings.js.
const IMPORTED_DAYS = 21;
const expiresAt = (vacancy) =>
  new Date(new Date(vacancy.bumped_at || vacancy.created_at).getTime() + IMPORTED_DAYS * 24 * 3600 * 1000).toISOString();

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по вакансии «${title}» на Шабашка.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function VacancyDetail() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    api
      .vacancy(id)
      .then(({ vacancy }) => setVacancy(vacancy))
      .catch((e) => setError(e.message));
    // С одной вакансии раньше некуда было идти дальше — человек уходил с сайта.
    api
      .similarVacancies(id)
      .then(({ vacancies }) => setSimilar(vacancies))
      .catch(() => {});
  }, [id]);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: vacancy.title, url });
      } catch {
        // пользователь отменил
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMsg('Ссылка скопирована');
    setTimeout(() => setShareMsg(''), 2500);
  }

  // «Работа» с предоплатой за обучение, форму или медосмотр приходит именно
  // вакансией — пожаловаться на неё нужно уметь так же, как на заказ.
  async function handleReport() {
    const reason = window.prompt('Опишите, что не так с этой вакансией:');
    if (!reason || !reason.trim()) return;
    try {
      await api.reportVacancy(vacancy.id, reason);
      setReportMsg('Жалоба отправлена — разберём в ближайшее время');
    } catch (err) {
      setReportMsg(err.message);
    }
    setTimeout(() => setReportMsg(''), 4000);
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSendError('');
    setSending(true);
    try {
      const { conversation } = await api.startVacancyConversation(vacancy.id, draft, token);
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  useMeta(
    vacancy && `${vacancy.title} — Шабашка`,
    vacancy &&
      `${vacancy.category} · ${vacancy.city} · ${formatSalary(vacancy.salary_min, vacancy.salary_max)} — ${vacancy.description}`.slice(
        0,
        160
      )
  );

  useJsonLd(
    vacancy && {
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title: vacancy.title,
      description: vacancy.description,
      datePosted: vacancy.created_at,
      // Вакансию из чата бэкенд закрывает сам через три недели после выхода или
      // поднятия, кроме закреплённой (см. backend/src/staleListings.js) — Google
      // должен знать срок, иначе показывает в поиске давно занятые места.
      ...(vacancy.is_imported && !vacancy.pinned ? { validThrough: expiresAt(vacancy) } : {}),
      employmentType: SCHEMA_EMPLOYMENT_TYPE[vacancy.employment_type] || 'OTHER',
      hiringOrganization: {
        '@type': 'Organization',
        name: vacancy.is_imported ? IMPORTED_EMPLOYER : vacancy.owner_name,
      },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: vacancy.city,
          addressCountry: 'KG',
        },
      },
      // У удалённой работы Google требует страну, откуда можно откликаться
      // (как в backend/src/meta.js), иначе вакансия не идёт в блок вакансий.
      ...(vacancy.work_format === 'online'
        ? {
            jobLocationType: 'TELECOMMUTE',
            applicantLocationRequirements: { '@type': 'Country', name: 'Kyrgyzstan' },
          }
        : {}),
      // Меньше 5 000 сом — за день, «10 сом» — не зарплата (см. salary.js).
      ...(salaryOf(vacancy.salary_min) || salaryOf(vacancy.salary_max)
        ? {
            baseSalary: {
              '@type': 'MonetaryAmount',
              currency: 'KGS',
              value: {
                '@type': 'QuantitativeValue',
                minValue: salaryOf(vacancy.salary_min) || salaryOf(vacancy.salary_max),
                maxValue: salaryOf(vacancy.salary_max) || salaryOf(vacancy.salary_min),
                unitText: salaryUnit(vacancy.salary_min, vacancy.salary_max),
              },
            },
          }
        : {}),
    }
  );

  if (error) return <p className="status-msg error">{error}</p>;
  if (!vacancy) return <SkeletonOrderDetail />;

  const isOwner = user?.id === vacancy.user_id;
  const views = shownViews(vacancy, isOwner);
  const categoryLanding = landingForCategory(vacancy.category);

  return (
    <div className="order-detail-wrap">
      <Link to="/vacancies" className="back-link">
        ← Ко всем вакансиям
      </Link>
      <div className="order-detail">
        <div className="badges-row">
          <span className="badge">{vacancy.category}</span>
          <span className={`badge status-${vacancy.status}`}>
            {vacancy.status === 'open' ? 'Открыта' : 'Закрыта'}
          </span>
          {!!vacancy.for_students && <StudentBadge />}
          {!!vacancy.pinned && <span className="badge pinned">🔥 Топ</span>}
          {!!vacancy.is_example && <span className="badge badge-example">Пример</span>}
          <FavoriteButton type="vacancy" id={vacancy.id} className="order-detail-fav" />
        </div>
        <h1>{vacancy.title}</h1>
        <p className="meta">
          <span>💼 {employmentLabel(vacancy.employment_type)}</span>
          <span><FormatIcon name={vacancy.work_format === 'online' ? 'online' : 'offline'} size={15} /> {vacancy.work_format === 'online' ? 'Онлайн' : 'Офлайн'}</span>
          <span>🎯 Опыт: {experienceLabel(vacancy.experience)}</span>
          <span>
            📍 {vacancy.city}
            {vacancy.address ? `, ${vacancy.address}` : ''}
          </span>
          {vacancy.schedule && <span>🗓 {vacancy.schedule}</span>}
          {/* У вакансии из чата «работодателем» было имя админа, от чьего имени её
              публикует бот. Честнее — откуда она и что с ней сделали. */}
          {vacancy.is_imported ? (
            <span>🛡 Из чата · прошла фильтр Шабашки</span>
          ) : (
            <span>👤 Работодатель: {vacancy.owner_name}</span>
          )}
          <span>
            👁 {views} {viewWord(views)}
          </span>
        </p>

        <div className="budget-box">
          <span className="label">Зарплата</span>
          <span className="value">{formatSalary(vacancy.salary_min, vacancy.salary_max)}</span>
        </div>

        <h3 className="desc-heading">Обязанности</h3>
        <p className="description">{vacancy.description}</p>

        {vacancy.requirements && (
          <>
            <h3 className="desc-heading">Требования</h3>
            <p className="description">{vacancy.requirements}</p>
          </>
        )}

        {vacancy.conditions && (
          <>
            <h3 className="desc-heading">Условия</h3>
            <p className="description">{vacancy.conditions}</p>
          </>
        )}

        {vacancy.is_example ? (
          <p className="status-msg">
            Это пример вакансии — он показывает, как выглядит реальное объявление. Откликнуться
            нельзя, отклики на него никто не увидит.
          </p>
        ) : vacancy.status === 'closed' ? (
          <p className="status-msg">Эта вакансия уже закрыта.</p>
        ) : (
          vacancy.whatsapp_phone && (
            // Панель контакта прилипает к низу экрана: кнопка WhatsApp стояла ниже
            // первого экрана (959 px при 746 видимых), а «Позвонить» не было вовсе —
            // хотя в посте номер есть и звонят оттуда в одно касание (аудит
            // 12 ноября 2026, см. docs/research).
            <div className="contact-bar">
              <a className="contact-call" href={telLink(vacancy.whatsapp_phone)} onClick={() => trackContact(vacancy.id, 'tel')}>
                📞 Позвонить
              </a>
              <a
                className="whatsapp-btn"
                href={waLink(vacancy.whatsapp_phone, vacancy.title)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackContact(vacancy.id, 'wa')}
              >
                💬 WhatsApp
              </a>
            </div>
          )
        )}

        {/* Повод вернуться — сразу под контактом, а не после блока «Войдите»:
            кто нажал «Позвонить», дальше уже не листает. С поста приходят на
            одну вакансию — следующие по этой профессии пусть придут сами. */}
        {!vacancy.is_example && (
          <div className="detail-subscribe">
            <SubscribeButton category={vacancy.category} />
            <span>Раз в час днём и только когда есть новые. Без регистрации.</span>
          </div>
        )}

        {!vacancy.is_example && vacancy.status !== 'closed' && (
          <>
            {!isOwner && (
              <div className="apply-box">
                <h3>Или напишите прямо здесь</h3>
                {user ? (
                  <form onSubmit={handleSendMessage}>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      placeholder="Расскажите коротко о себе и опыте — работодатель ответит в этой переписке."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {sendError && <p className="status-msg error">{sendError}</p>}
                    <button className="submit-btn" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? 'Отправляем…' : 'Отправить отклик'}
                    </button>
                  </form>
                ) : (
                  <p className="apply-login-hint">
                    <Link to="/login" state={{ from: { pathname: `/vacancies/${vacancy.id}` } }}>
                      Войдите
                    </Link>{' '}
                    или <Link to="/register">зарегистрируйтесь</Link>, чтобы переписываться с
                    работодателем на сайте. Написать в WhatsApp можно и без аккаунта.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!vacancy.is_example && <SafetyNote isImported={vacancy.is_imported} />}

        {/* single — когда рядом с «Поделиться» никого нет: у примера вакансии
            нет ни кнопки правки, ни жалобы. */}
        <div className={`secondary-actions${!isOwner && vacancy.is_example ? ' single' : ''}`}>
          <button type="button" onClick={handleShare}>
            🔗 {shareMsg || 'Поделиться'}
          </button>
          {isOwner ? (
            <Link to={`/vacancies/${vacancy.id}/edit`} className="admin-btn-ghost secondary-link">
              ✏️ Изменить вакансию
            </Link>
          ) : (
            !vacancy.is_example && (
              <button type="button" className="muted" onClick={handleReport}>
                ⚑ {reportMsg || 'Пожаловаться'}
              </button>
            )
          )}
        </div>

        {!vacancy.is_example && (
          <p className="hint">
            {vacancy.whatsapp_phone
              ? 'В WhatsApp можно написать без регистрации. Переписка на сайте — для тех, кто вошёл в аккаунт.'
              : 'Работодатель не указал WhatsApp — написать можно только через переписку на сайте, для этого нужен аккаунт.'}
          </p>
        )}
      </div>

      {similar.length > 0 && (
        <div className="similar-orders">
          <div className="section-head">
            <h2>Ещё вакансии</h2>
            {/* Своя профессия — на её страницу (см. landings.js), иначе — ко всем. */}
            {categoryLanding ? (
              <Link to={landingPath(categoryLanding)}>Все: {categoryLanding.short.toLowerCase()}</Link>
            ) : (
              <Link to="/vacancies">Все вакансии</Link>
            )}
          </div>
          <div className="order-grid">
            {similar.map((v) => (
              <VacancyCard key={v.id} vacancy={v} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
