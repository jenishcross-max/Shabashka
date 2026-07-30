import { useEffect, useState } from 'react';
import { onPendingChange } from '../api';

// Тёплый сервер отвечает за десятки миллисекунд, так что пять секунд ожидания —
// это почти наверняка не медленный интернет, а поднимающийся контейнер Render.
// Раньше показывать нельзя: на плохой мобильной связи баннер мигал бы зря.
const QUIET_MS = 5000;

export default function WakingBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let timer = null;

    const stop = onPendingChange((pending) => {
      if (pending > 0) {
        if (!timer) timer = setTimeout(() => setWaking(true), QUIET_MS);
        return;
      }
      clearTimeout(timer);
      timer = null;
      setWaking(false);
    });

    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

  if (!waking) return null;

  return (
    <div className="waking-banner" role="status">
      ⏳ Сервер просыпается после простоя — это занимает до минуты. Ничего нажимать не нужно,
      объявления появятся сами.
    </div>
  );
}
