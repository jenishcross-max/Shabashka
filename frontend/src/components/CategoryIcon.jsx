// Иконки категорий рисуем SVG, а не эмодзи: эмодзи выглядят по-разному в
// каждой ОС, а под онлайн-категории («Дизайн», «Переводы», …) подходящих
// эмодзи просто нет — они все сваливались в одну общую 🗂️.

const ICONS = {
  'Ремонт': (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
  ),
  'Уборка': (
    <>
      <rect x="7" y="9" width="9.5" height="12.5" rx="2.5" />
      <path d="M7 9V6a1.5 1.5 0 0 1 1.5-1.5H12V9" />
      <path d="M12 5h3.5l2.5-2.5" />
      <line x1="20" y1="6" x2="21.8" y2="6" />
      <line x1="19.6" y1="9" x2="21.3" y2="10" />
      <line x1="19.6" y1="3" x2="21.3" y2="2" />
    </>
  ),
  'Грузоперевозки': (
    <>
      <rect x="1" y="5" width="14" height="11" rx="1.5" />
      <path d="M15 9h4l3 3v4h-7z" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="18.5" r="2" />
    </>
  ),
  'Репетиторы': (
    <>
      <path d="M2 4h6a3.5 3.5 0 0 1 3.5 3.5V20a2.8 2.8 0 0 0-2.8-2.5H2z" />
      <path d="M22 4h-6a3.5 3.5 0 0 0-3.5 3.5V20a2.8 2.8 0 0 1 2.8-2.5H22z" />
    </>
  ),
  'Красота': (
    <>
      <circle cx="6" cy="6.5" r="2.6" />
      <circle cx="6" cy="17.5" r="2.6" />
      <line x1="20" y1="4.5" x2="8.3" y2="15.9" />
      <line x1="14.4" y1="14.6" x2="20" y2="19.5" />
      <line x1="8.3" y1="8.1" x2="11.8" y2="11.6" />
    </>
  ),
  'Электрика': <path d="M13 2.5L4 13.5h7l-1 8 9-11h-7z" />,
  'Сантехника': <path d="M12 3l5.7 5.9a8 8 0 1 1-11.4 0z" />,
  'Сад и огород': (
    <>
      <line x1="12" y1="21.5" x2="12" y2="12" />
      <path d="M12 13.5c0-3.6 2.9-6.5 6.5-6.5 0 3.6-2.9 6.5-6.5 6.5z" />
      <path d="M12 16c0-3-2.5-5.5-5.5-5.5 0 3 2.5 5.5 5.5 5.5z" />
    </>
  ),
  'Дизайн': (
    <>
      <path d="M12 19l7-7 3 3-7 7z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
      <line x1="2" y1="2" x2="9.6" y2="9.6" />
      <circle cx="11" cy="11" r="1.8" />
    </>
  ),
  'Программирование и IT': (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  'Переводы': (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <line x1="2.5" y1="12" x2="21.5" y2="12" />
      <path d="M12 2.5a15 15 0 0 1 0 19 15 15 0 0 1 0-19z" />
    </>
  ),
  'Копирайтинг и тексты': (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  'Онлайн-консультации': (
    <>
      <path d="M3.5 18v-5.5a8.5 8.5 0 0 1 17 0V18" />
      <path d="M20.5 19a2 2 0 0 1-2 2h-1V14h1a2 2 0 0 1 2 2z" />
      <path d="M3.5 19a2 2 0 0 0 2 2h1V14h-1a2 2 0 0 0-2 2z" />
    </>
  ),
  'Маркетинг и SMM': (
    <>
      <path d="M3 10.5v3a1 1 0 0 0 1 1h2l9 5V4.5l-9 5H4a1 1 0 0 0-1 1z" />
      <path d="M18.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  'Бухгалтерия онлайн': (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
      <rect x="7.5" y="5.5" width="9" height="4" rx="1" />
      <circle cx="8.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'Психология и коучинг': (
    <path d="M20.4 5.1a5.2 5.2 0 0 0-7.4 0L12 6.2l-1-1.1a5.2 5.2 0 0 0-7.4 7.4L12 21l8.4-8.5a5.2 5.2 0 0 0 0-7.4z" />
  ),
  'Другое': (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
};

const FALLBACK = (
  <>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
    <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
  </>
);

export default function CategoryIcon({ name, size = 22 }) {
  return (
    <svg
      className="category-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] || FALLBACK}
    </svg>
  );
}
