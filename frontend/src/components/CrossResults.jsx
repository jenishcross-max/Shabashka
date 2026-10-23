import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { orderWord, vacancyWord } from '../plural';
import OrderCard from './OrderCard';
import VacancyCard from './VacancyCard';

// Соседний список под основным: на «Подработке» — вакансии, на «Вакансиях» —
// подработка, с тем же поиском, городом и пометкой «для студентов».
//
// Вакансий на сайте вдевятеро больше, чем разовых заказов, а поиск с главной
// вёл только в заказы: «продавец» — 0 заказов при 154 вакансиях, «курьер» — 0
// при 73. Человек видел ноль и уходил. Со студентами так же: разовые заказы
// почти никогда не пишут «можно студентам», и на «Подработке» стоял ноль, хотя
// в вакансиях их десятки. Поэтому при поиске и с фильтром «Для студентов»
// соседний список выходит отдельным блоком, со своим заголовком и числом.
const KINDS = {
  vacancies: {
    load: (params) => api.vacancies(params),
    key: 'vacancies',
    name: 'Вакансии',
    word: vacancyWord,
    card: (item) => <VacancyCard key={item.id} vacancy={item} />,
  },
  orders: {
    load: (params) => api.orders(params),
    key: 'orders',
    name: 'Подработка',
    word: orderWord,
    card: (item) => <OrderCard key={item.id} order={item} />,
  },
};
const PREVIEW = 6;

// onTotal — сколько нашлось (null, пока ищем): по нему страница пишет над
// пустым списком «зато есть 154 вакансии», а не «попробуйте другое слово».
// alone — основной список пуст, и этот встаёт сразу под той строкой.
export default function CrossResults({ kind, q = '', city = '', students = false, alone = false, onTotal }) {
  const other = KINDS[kind];
  const query = q.trim();
  const [data, setData] = useState(null);
  const report = useRef(onTotal);
  report.current = onTotal;

  useEffect(() => {
    setData(null);
    report.current?.(null);
    if (!query && !students) return undefined;
    let alive = true;
    // Пауза — как у основного списка: поиск идёт по мере набора.
    const handle = setTimeout(() => {
      other
        .load({ q: query, city, students: students ? 1 : '', limit: PREVIEW })
        .then((res) => {
          if (!alive) return;
          setData({ items: res[other.key] || [], total: res.total || 0 });
          report.current?.(res.total || 0);
        })
        .catch(() => alive && report.current?.(0));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [other, query, city, students]);

  if (!data || !data.total) return null;

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (city) params.set('city', city);
  if (students) params.set('students', '1');
  const title = [
    students ? `🎓 ${other.name} для студентов` : other.name,
    query && `по запросу «${query}»`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={`cross-section${students ? ' is-students' : ''}${alone ? ' is-alone' : ''}`}>
      <h2 className="cross-section-head">
        {title} <span>{data.total}</span>
      </h2>
      <div className="order-grid orders-grid-2col">{data.items.map(other.card)}</div>
      {data.total > data.items.length && (
        <Link className="cross-section-all" to={`/${kind}?${params}`}>
          Все {data.total} {other.word(data.total)} →
        </Link>
      )}
    </section>
  );
}
