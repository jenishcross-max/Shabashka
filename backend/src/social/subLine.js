// Строка подписки в бота в постах Threads: «📲 Новые вакансии «Общепит» — в
// Telegram: шабашка.com/s/obshchepit».
//
// Пост-вакансия с номером самодостаточен: человек звонит прямо из ленты, и на
// сайт из сотен просмотров переходят единицы (замер 21 октября 2026, см.
// docs/plans/2026-10-21-subscribe-and-sources.md). Строка «👉 Все N за сутки»
// этого не изменила. Поэтому у части постов вместо неё — подписка на ту же
// профессию в боте (см. telegram/subscriptions.js): подписчик сам вернётся за
// следующими вакансиями. Сравнить, что работает лучше, — по сводке бота
// (переходы в бота) и Метрике (заходы из Threads).
//
// Только вакансии: бот присылает их одни, и звать в него из поста-заказа —
// обещать не то. Только профессии с посадочной страницей (landings.js): у
// «Другого» подписки нет. Рекламе и посту со строкой «подпишись» строки нет —
// решает shareListing в index.js.
//
// /s/<slug> — короткий адрес на сайте: Netlify ведёт его в бота через
// routes/subscribe.js, и тот считает переход (см. netlify.toml).
const landings = require('../landings');
const { parseEvery: parse } = require('./follow');

// SUB_EVERY — у какого по счёту поста-вакансии с профессией строка; off или 0 —
// нигде, тогда у всех остаётся «Все N за сутки».
const parseEvery = (value) => parse(value, 2);
const EVERY = parseEvery(process.env.SUB_EVERY);

let posts = 0;

// siteLink — ссылка поста на карточку («шабашка.com/vacancies/12»): из неё берём
// адрес сайта, чтобы не держать его здесь второй раз.
function line(listingType, parsed, siteLink) {
  if (!EVERY || listingType !== 'vacancy') return '';
  const category = parsed && parsed.category;
  const page = category ? landings.find((l) => l.category === category) : null;
  const host = String(siteLink || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!page || !host) return '';
  posts += 1;
  return posts % EVERY === 0 ? `📲 Новые вакансии «${page.category}» — в Telegram: ${host}/s/${page.slug}` : '';
}

module.exports = { line, parseEvery, EVERY };
