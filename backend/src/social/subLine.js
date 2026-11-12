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

// Тест «группа против бота» (аудит 12 ноября 2026, см. docs/research): группа с
// кнопкой под каждым постом за неделю выросла на 18%, а бот за месяц набрал два
// десятка подписчиков. Каждая вторая строка подписки зовёт в Telegram-группу —
// через шабашка.com/g, где переход считается (см. routes/go.js), рядом с
// переходами в бота по /s/. Что приводит больше, видно в сводке. SUB_GROUP=off —
// только бот.
const parseGroup = (value) => !/^(off|no|нет|-|0)$/i.test(String(value ?? '').trim());

function create({ every = EVERY, group = 'on' } = {}) {
  const withGroup = parseGroup(group);
  let posts = 0;
  let slots = 0;

  // siteLink — ссылка поста на карточку («шабашка.com/vacancies/12»): из неё берём
  // адрес сайта, чтобы не держать его здесь второй раз.
  return function line(listingType, parsed, siteLink) {
    if (!every || listingType !== 'vacancy') return '';
    const category = parsed && parsed.category;
    const page = category ? landings.find((l) => l.category === category) : null;
    const host = String(siteLink || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    if (!page || !host) return '';
    posts += 1;
    if (posts % every !== 0) return '';
    slots += 1;
    if (withGroup && slots % 2 === 0) {
      return `✈️ Вакансии «${page.category}» и вся работа — каждый день в Telegram-группе: ${host}/g`;
    }
    return `📲 Новые вакансии «${page.category}» — в Telegram: ${host}/s/${page.slug}`;
  };
}

const line = create({ group: process.env.SUB_GROUP });

module.exports = { line, create, parseEvery, parseGroup, EVERY };
