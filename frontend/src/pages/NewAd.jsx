import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import { CATEGORIES, CATEGORY_HINTS, KINDS, PRICE_UNITS } from '../ads';
import Logo from '../components/Logo';
import CityAutocomplete from '../components/CityAutocomplete';
import PhotoPicker from '../components/PhotoPicker';
import { SkeletonForm } from '../components/Skeleton';

// Подсказки к заголовку под выбранный вид — пустое поле с «Заголовок» людей
// пугает, а пример сразу показывает, чего ждут.
const TITLE_EXAMPLES = {
  rent_out: 'Например: сдаю 1-комнатную квартиру в 10 мкр',
  rent: 'Например: сниму комнату недалеко от КНУ',
  sell: 'Например: продаю холодильник Samsung, 2 года',
  buy: 'Например: куплю детскую коляску',
  free: 'Например: отдам котят в добрые руки',
};

// Одна форма на «подать» и «изменить»: поля те же, разница только в том,
// откуда начальные значения и куда уходит запрос. Сервер проверяет всё заново
// (см. backend/src/adsRules.js) — здесь только удобство.
export default function NewAd() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { token, user } = useAuth();
  const cities = useCities();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    kind: 'rent_out',
    category: 'housing',
    title: '',
    description: '',
    price: '',
    price_unit: 'total',
    city: user?.city || '',
    address: '',
    whatsapp_phone: '',
    photos: [],
  });
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!editing) return;
    api
      .ad(id, token)
      .then(({ ad }) => {
        if (ad.user_id !== user?.id) throw new Error('Это не ваше объявление');
        if (ad.status === 'removed') throw new Error('Объявление снято модератором — его можно только удалить');
        setForm({
          kind: ad.kind,
          category: ad.category,
          title: ad.title,
          description: ad.description,
          price: ad.price ? String(ad.price) : '',
          price_unit: ad.price_unit || 'total',
          city: ad.city,
          address: ad.address || '',
          whatsapp_phone: ad.whatsapp_phone || '',
          photos: ad.photos,
        });
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [editing, id, token, user?.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form, price: form.price.trim(), photos: form.photos.map((p) => p.path) };
      const { ad } = editing ? await api.updateAd(id, payload, token) : await api.createAd(payload, token);
      navigate(`/ads/${ad.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return error ? (
      <p className="status-msg error">
        {error}. <Link to={`/ads/${id}`}>Вернуться к объявлению</Link>
      </p>
    ) : (
      <SkeletonForm fields={6} />
    );
  }

  const free = form.kind === 'free';
  const wanted = form.kind === 'buy' || form.kind === 'rent';

  return (
    <div className="form-card wide">
      <div className="card-header">
        <Logo size="sm" />
        <span className="who">{user?.name} · Объявления</span>
      </div>
      <div className="card-body">
        <h1>{editing ? 'Изменить объявление' : 'Подать объявление'}</h1>
        <p className="subtitle">Сдаёте, продаёте или ищете — опишите, приложите фото, и вам напишут.</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <span className="label">Что вы делаете</span>
            <div className="ads-kinds ads-kinds-form">
              {KINDS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={form.kind === value ? 'active' : ''}
                  onClick={() => setForm((f) => ({ ...f, kind: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="label">Рубрика</span>
            <select value={form.category} onChange={set('category')}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} — {CATEGORY_HINTS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Заголовок</span>
            <input required maxLength={100} placeholder={TITLE_EXAMPLES[form.kind]} value={form.title} onChange={set('title')} />
          </label>
          <label className="field">
            <span className="label">Описание</span>
            <textarea
              required
              rows={5}
              maxLength={3000}
              placeholder="Состояние, размеры, что входит, когда можно посмотреть"
              value={form.description}
              onChange={set('description')}
            />
          </label>

          <PhotoPicker
            value={form.photos}
            onChange={(photos) => setForm((f) => ({ ...f, photos }))}
            onBusyChange={setUploading}
          />

          {!free && (
            <div className="field-row">
              <label className="field">
                <span className="label">{wanted ? 'Бюджет до, сом' : 'Цена, сом'}</span>
                <input
                  inputMode="numeric"
                  placeholder="Пусто — договорная"
                  value={form.price}
                  onChange={set('price')}
                />
              </label>
              <label className="field">
                <span className="label">За что</span>
                <select value={form.price_unit} onChange={set('price_unit')} disabled={!form.price.trim()}>
                  {PRICE_UNITS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="field-row">
            <label className="field">
              <span className="label">Город</span>
              <CityAutocomplete
                required
                cities={cities}
                value={form.city}
                onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              />
            </label>
            <label className="field">
              <span className="label">Район или адрес (необязательно)</span>
              <input maxLength={200} placeholder="Например: мкр. Асанбай" value={form.address} onChange={set('address')} />
            </label>
          </div>
          <label className="field">
            <span className="label">WhatsApp (необязательно)</span>
            <input
              type="tel"
              placeholder="0700 123 456"
              value={form.whatsapp_phone}
              onChange={set('whatsapp_phone')}
            />
          </label>
          <p className="format-hint">
            Без WhatsApp вам напишут в «Сообщения» на сайте. Номер увидят все, кто откроет объявление.
          </p>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting || uploading}>
            {uploading
              ? 'Дождитесь загрузки фото…'
              : submitting
              ? editing
                ? 'Сохраняем…'
                : 'Публикуем…'
              : editing
              ? 'Сохранить'
              : 'Опубликовать объявление'}
          </button>
        </form>
      </div>
    </div>
  );
}
