import { useRef, useState } from 'react';
import { uploadAdPhoto } from '../api';
import { useAuth } from '../context/AuthContext';
import { shrinkPhoto } from '../shrinkPhoto';
import { MAX_PHOTOS } from '../ads';

// Фото объявления: выбрать, ужать в браузере, загрузить прямо в хранилище.
// value — список { path, url }; первое фото — обложка в ленте, поэтому порядок
// можно менять. Грузим по одному: шесть параллельных загрузок по мобильной
// сети чаще обрываются, чем шесть подряд.
export default function PhotoPicker({ value, onChange, onBusyChange }) {
  const { token } = useAuth();
  const input = useRef(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function pick(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_PHOTOS - value.length);
    e.target.value = ''; // то же фото можно выбрать снова после ошибки
    if (!files.length) return;
    setError('');
    onBusyChange(true);
    let photos = value;
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Загружаем фото ${i + 1} из ${files.length}…`);
        const blob = await shrinkPhoto(file);
        photos = [...photos, await uploadAdPhoto(blob, token)];
        onChange(photos);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress('');
      onBusyChange(false);
    }
  }

  const move = (from, to) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="field">
      <span className="label">
        Фото (до {MAX_PHOTOS}, первое — обложка)
      </span>
      <div className="photo-picker">
        {value.map((photo, i) => (
          <div key={photo.path} className="photo-picker-item">
            <img src={photo.url} alt={`Фото ${i + 1}`} />
            {i === 0 && <span className="photo-picker-cover">Обложка</span>}
            {/* Пока идёт загрузка, порядок не трогаем: список допишется поверх правки. */}
            <fieldset className="photo-picker-tools" disabled={!!progress}>
              <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Сдвинуть влево">
                ←
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label="Убрать фото"
              >
                ✕
              </button>
              <button
                type="button"
                disabled={i === value.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label="Сдвинуть вправо"
              >
                →
              </button>
            </fieldset>
          </div>
        ))}
        {value.length < MAX_PHOTOS && (
          <button type="button" className="photo-picker-add" disabled={!!progress} onClick={() => input.current.click()}>
            {progress || '+ Добавить фото'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={pick} />
      {error && <p className="status-msg error">{error}</p>}
    </div>
  );
}
