const { abroadWork } = require('./abroad');
const { money } = require('./money');

// Биржа услуг: правила задач и откликов без базы (запросы — в tasksRepo.js).
// Всё «можно или нельзя» решается здесь: сайт и будущее Android-приложение
// получают от роута один и тот же ответ, а тесты проверяют правила без Postgres.

const WORK_FORMATS = ['online', 'offline'];
const MAX_PRICE = 10000000;
const LIMITS = { title: 100, description: 3000, city: 60, address: 200, when: 60, term: 60, comment: 1000 };

const text = (value) => String(value ?? '').trim();

// Цену набирают как на ценнике — «2 000» и «2000» одно и то же.
function toPrice(value) {
  const n = Number(text(value).replace(/\s/g, ''));
  return Number.isInteger(n) && n >= 1 && n <= MAX_PRICE ? n : null;
}

// partial — правка: проверяем только присланные поля, остальные не трогаем.
function validateTask(body, { categories, partial = false }) {
  const errors = [];
  const result = {};
  const given = (key) => !partial || body[key] !== undefined;

  if (given('title')) {
    const v = text(body.title);
    if (!v) errors.push('Напишите, что нужно сделать');
    else if (v.length > LIMITS.title) errors.push(`Название слишком длинное (макс. ${LIMITS.title} символов)`);
    else result.title = v;
  }
  if (given('description')) {
    const v = text(body.description);
    if (!v) errors.push('Опишите задачу подробнее');
    else if (v.length > LIMITS.description) {
      errors.push(`Описание слишком длинное (макс. ${LIMITS.description} символов)`);
    } else result.description = v;
  }
  if (given('category')) {
    if (!categories.includes(body.category)) errors.push('Выберите категорию из списка');
    else result.category = body.category;
  }
  if (given('city')) {
    const v = text(body.city);
    if (!v) errors.push('Укажите город');
    else if (v.length > LIMITS.city) errors.push('Слишком длинное название города');
    else result.city = v;
  }
  if (given('address')) {
    const v = text(body.address);
    if (v.length > LIMITS.address) errors.push(`Адрес слишком длинный (макс. ${LIMITS.address} символов)`);
    else result.address = v || null;
  }
  if (given('work_format')) {
    if (!WORK_FORMATS.includes(body.work_format)) errors.push('Укажите формат работы — онлайн или офлайн');
    else result.work_format = body.work_format;
  }
  if (given('budget')) {
    if (!text(body.budget)) result.budget = null;
    else {
      const n = toPrice(body.budget);
      if (n === null) errors.push('Бюджет — целое число сом, или оставьте поле пустым');
      else result.budget = n;
    }
  }
  if (given('when_text')) {
    const v = text(body.when_text);
    if (v.length > LIMITS.when) errors.push('Срок слишком длинный — хватит пары слов');
    else result.when_text = v || null;
  }

  // Только работа в Кыргызстане — то же правило, что у заказов (см. abroad.js).
  // При правке смотрим то, что пришло: заграница в одном поле — тоже заграница.
  const abroad = abroadWork([result.title, result.description, result.city].filter(Boolean).join('\n'), {
    job: true,
  });
  if (abroad) errors.push(`Шабашка публикует только работу в Кыргызстане, а здесь указано «${abroad}»`);

  return { errors, result };
}

function validateOffer(body = {}) {
  const errors = [];
  const price = toPrice(body.price);
  if (price === null) errors.push('Укажите цену — целое число сом');
  const term = text(body.term);
  if (!term) errors.push('Укажите срок: например, «завтра до обеда»');
  else if (term.length > LIMITS.term) errors.push('Срок слишком длинный — хватит пары слов');
  const comment = text(body.comment);
  if (!comment) errors.push('Напишите, что именно сделаете');
  else if (comment.length > LIMITS.comment) {
    errors.push(`Комментарий слишком длинный (макс. ${LIMITS.comment} символов)`);
  }
  return { errors, result: { price, term, comment } };
}

// Почему с задачей уже ничего не сделать — по её статусу.
const CLOSED = {
  assigned: 'Исполнитель уже выбран',
  done: 'Задача уже выполнена',
  cancelled: 'Задача отменена',
};
const FINAL = ['done', 'cancelled'];

// Почему откликнуться нельзя; null — можно. offer — прежний отклик этого
// человека на эту задачу, если был.
function offerBlocker(task, userId, offer) {
  if (task.user_id === userId) return { status: 400, error: 'Это ваша задача — откликнуться на неё нельзя' };
  if (task.status !== 'open') return { status: 409, error: CLOSED[task.status] };
  // Снятый модератором и отменённый заказчиком отклик правкой не воскресает:
  // иначе «удалить отклик» и «отменить выбор» ничего бы не значили.
  if (offer?.status === 'removed') return { status: 403, error: 'Ваш отклик снял модератор' };
  if (offer?.status === 'dropped') {
    return { status: 403, error: 'Заказчик отменил выбор — откликнуться на эту задачу снова нельзя' };
  }
  return null;
}

// Действия заказчика и статусы, из которых они возможны. error — что сказать,
// если статус не тот, но и не окончательный (выполнена/отменена).
const OWNER_ACTIONS = {
  edit: { from: ['open'], error: 'Задачу можно править, пока исполнитель не выбран' },
  accept: { from: ['open'] },
  unassign: { from: ['assigned'], error: 'Исполнитель ещё не выбран' },
  done: { from: ['assigned'], error: 'Сначала выберите исполнителя' },
  cancel: { from: ['open', 'assigned'] },
};

function ownerBlocker(task, userId, action) {
  if (task.user_id !== userId) return { status: 403, error: 'Это не ваша задача' };
  const rule = OWNER_ACTIONS[action];
  if (rule.from.includes(task.status)) return null;
  const error = FINAL.includes(task.status) ? CLOSED[task.status] : rule.error || CLOSED[task.status];
  return { status: 409, error };
}

function withdrawBlocker(task, offer) {
  if (!offer || offer.status !== 'active') return { status: 404, error: 'Отклика, который можно отозвать, нет' };
  if (task.status !== 'open') return { status: 409, error: CLOSED[task.status] };
  return null;
}

// Что исполнитель видит про свой отклик — одним словом, чтобы сайт и приложение
// показывали одно и то же: waiting — ждёт решения, chosen — выбран, done —
// выполнил, other — выбран другой, cancelled — задачу отменили, withdrawn —
// отозвал сам, dropped — заказчик отменил выбор, removed — снят модератором.
function offerState(offerStatus, taskStatus) {
  if (['withdrawn', 'dropped', 'removed'].includes(offerStatus)) return offerStatus;
  if (taskStatus === 'cancelled') return 'cancelled';
  if (offerStatus === 'accepted') return taskStatus === 'done' ? 'done' : 'chosen';
  return taskStatus === 'open' ? 'waiting' : 'other';
}

// Первое сообщение в переписке после выбора. Уходит от имени заказчика: так у
// исполнителя загорается обычный значок непрочитанного и ответить можно сразу.
function chosenMessage(task, offer) {
  return (
    `Здравствуйте! Выбираю вас исполнителем по задаче «${task.title}»: ` +
    `${money(offer.price)} сом, срок — ${offer.term}. Давайте договоримся о деталях.`
  );
}

module.exports = {
  validateTask,
  validateOffer,
  offerBlocker,
  ownerBlocker,
  withdrawBlocker,
  offerState,
  chosenMessage,
  LIMITS,
  MAX_PRICE,
};
