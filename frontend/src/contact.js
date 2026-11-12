// Счётчик отклика (аудит 12 ноября 2026, см. docs/research/2026-11-audit.md).
// Сколько людей написали или позвонили работодателю, не знал никто: Метрика
// видела только просмотры страниц, а кнопка WhatsApp вела прямо на wa.me. Теперь
// кнопка по-прежнему открывает WhatsApp или звонок сама, а заодно сообщает бэкенду,
// что её нажали и с какой площадки пришёл человек (см. backend/src/routes/contact.js;
// источник запоминает скрипт метки в index.html). Число видно в сводке бота.
const API_BASE = import.meta.env.VITE_API_URL || '/api';
const METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID;

function entrySource() {
  try {
    return sessionStorage.getItem('shabashka:src') || 'direct';
  } catch {
    return 'direct';
  }
}

// how — 'wa' или 'tel'. sendBeacon доходит, даже когда страница уже уходит в
// WhatsApp; нет его — отклик просто не посчитается, кнопка работает всё равно.
export function trackContact(vacancyId, how) {
  try {
    navigator.sendBeacon?.(`${API_BASE}/contact/vacancy/${vacancyId}`, JSON.stringify({ how, from: entrySource() }));
  } catch {
    // счётчик не должен мешать отклику
  }
  if (METRIKA_ID && import.meta.env.PROD && typeof window.ym === 'function') {
    window.ym(METRIKA_ID, 'reachGoal', how === 'tel' ? 'contact_tel' : 'contact_wa');
  }
}

// Номер для tel: — с плюсом у международного вида (996…), как набирает телефон.
export function telLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 11 ? `tel:+${digits}` : `tel:${digits}`;
}
