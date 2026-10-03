const extract = require('../telegram/extract');
const { PRICE, GOAL, SITE } = require('./texts');

// Мозг ИИ-продавца в директе: понять, чего хочет человек (classify), и решить,
// что ответить и куда двигать разговор (decide).
//
// Разговор — это лесенка стадий:
//   new → offered (назвали цену) → awaiting_payment (дали номер МБанка)
//       → publishing (чек принят, публикуем) → published (ссылка отправлена)
// с боковыми ветками: awaiting_text — оплатили, а текста объявления ещё нет;
// checking — чек смотрит админ; declined — отказался.
//
// Переходы решает код, а не модель: номер для оплаты уходит только после
// согласия, публикация — только после принятого чека. Модель на бесплатном
// тарифе может ошибиться в понимании — но не может сама отправить реквизиты
// или выложить неоплаченное.

const INTENTS = ['ad', 'agree', 'decline', 'paid', 'job', 'question', 'human', 'greeting', 'other'];

const STAGE_HINTS = {
  new: 'разговор только начался',
  offered: 'мы назвали цену и спросили, размещаем ли',
  awaiting_payment: 'мы прислали номер МБанка и ждём скриншот чека',
  awaiting_text: 'оплата получена, ждём текст объявления',
  checking: 'чек на проверке у администратора',
  publishing: 'реклама публикуется',
  published: 'реклама уже вышла, ссылку отправили',
  declined: 'человек раньше отказался',
};

function system() {
  return [
    `Ты — помощник Шабашки в личных сообщениях Threads. Шабашка публикует объявления о работе и заказах в Кыргызстане и продаёт рекламу: ${PRICE} сом за пост в Threads, ролик в Instagram и объявление на сайте ${SITE}; гарантия ${GOAL}+ просмотров за сутки, через сутки — отчёт; выходит сразу после оплаты на МБанк. Своих вакансий у Шабашки нет — она не работодатель и не знает подробностей чужих вакансий.`,
    '',
    'Прочитай переписку и последнее сообщение человека. Верни только JSON:',
    '{"intent":string,"lang":"ru"|"ky","ad_text":string,"forbidden":boolean,"answer":string}',
    '',
    'intent — одно из:',
    '- "ad" — хочет разместить рекламу или объявление, спрашивает цену или как разместить;',
    '- "agree" — соглашается разместить или оплатить («да», «давайте», «ок», «куда платить», «макул», «ооба», «кантип төлөйм»);',
    '- "decline" — отказывается или передумал;',
    '- "paid" — пишет, что уже оплатил, но чека не прислал;',
    '- "job" — принял Шабашку за работодателя: спрашивает про вакансию, работу, зарплату, адрес, хочет устроиться, «номер?», «ещё актуально?», «жумуш барбы»;',
    '- "question" — вопрос про рекламу или сервис, на который можно ответить по фактам выше;',
    '- "human" — жалоба, возврат денег, просит человека или администратора, либо вопрос, на который по фактам выше ответить нельзя;',
    '- "greeting" — только приветствие;',
    '- "other" — не по делу: спам, эмодзи, предлагают свои услуги Шабашке.',
    '',
    'ad_text — если в сообщениях человека есть сам текст объявления, которое он хочет опубликовать (что предлагает или ищет, условия, контакты), перепиши его дословно, ничего не меняя. Иначе пустая строка. «Хочу рекламу» или «сколько стоит» — это не текст объявления.',
    'forbidden — true, только если это объявление нельзя публиковать: наркотики, мошенничество и «лёгкие деньги», ставки и казино, займы, документы и дипломы, интим-услуги, оружие, продажа аккаунтов, работа за границей или набор людей на выезд, сетевой маркетинг и «работа в офисе» без профессии («помощник администратора», «карьерный рост, всему научим»), оформление машин, карт, ИП и кредитов на чужие документы за деньги.',
    'answer — только при intent "question": короткий ответ (до 300 знаков) на языке человека и только по фактам выше. Не придумывай номера, реквизиты, цены, сроки и обещания, которых нет в фактах. При другом intent — пустая строка.',
    'lang — "ky", если человек пишет по-кыргызски, иначе "ru".',
  ].join('\n');
}

// Переписка для модели: последние реплики и стадия разговора. Картинки
// словами — сами они модели разбора не нужны.
function transcript(history, stage, fresh) {
  const who = { them: 'Человек', bot: 'Шабашка', owner: 'Шабашка' };
  const lines = history
    .slice(-12)
    .map((h) => `${who[h.from] || 'Человек'}: ${h.text || ''}${h.image ? ' [картинка]' : ''}`.trim());
  return [
    `Стадия разговора: ${STAGE_HINTS[stage] || STAGE_HINTS.new}.`,
    '',
    'Переписка:',
    ...(lines.length ? lines : ['(пусто)']),
    '',
    'Последнее сообщение человека:',
    fresh,
  ].join('\n');
}

// Запасной разбор словами — на случай, когда модель недоступна: лимиты Groq
// выбраны или сеть легла. Человек в директе ждёт ответа, а не нормы токенов.
// Грубо, но главные развилки держит: реклама, согласие, отказ, вакансия.
// \b в JavaScript знает только латиницу: «да» в конце строки для него не
// слово. Поэтому конец слова — «дальше не буква».
const END = '(?![\\p{L}])';
const RULES = [
  ['decline', new RegExp(`^(нет|не надо|не нужно|передумал|жок|керек эмес)${END}`, 'iu')],
  ['paid', /(оплатил|оплатила|перевёл|перевел|перевела|скинул|төлөдүм|которудум)/iu],
  [
    'agree',
    new RegExp(
      `^(да|давайте|ок|окей|хорошо|согласен|согласна|конечно|куда (платить|скинуть)|ооба|макул|болот|мейли)${END}`,
      'iu'
    ),
  ],
  ['ad', /реклам|жарнам|размест|опубликуй|выложи|прайс|сколько стоит|канча турат|баасы/iu],
  ['job', /ваканси|работ[ауы]|зарплат|актуальн|устроит|жумуш|иш барбы|номер/iu],
  ['greeting', /^(здравствуй|привет|салам|ассалам|добрый|саламатсыз)/iu],
];

function guessLang(text) {
  return /[әөүңһ]|саламатсыз|жарнам|канча|керек|барбы|жумуш|рахмат|ооба|макул/i.test(text) ? 'ky' : 'ru';
}

function byRules(text) {
  const clean = String(text || '').trim();
  const hit = RULES.find(([, re]) => re.test(clean));
  return {
    intent: hit ? hit[0] : 'human',
    lang: guessLang(clean),
    adText: '',
    forbidden: false,
    answer: '',
    byRules: true,
  };
}

// Ответ модели на свободный вопрос уходит человеку как есть, поэтому его
// проверяем: номер телефона или счёта в нём может быть только выдуманным —
// настоящие реквизиты вставляет шаблон, а не модель.
function safeAnswer(answer) {
  const text = String(answer || '').trim();
  if (!text || text.length > 450) return '';
  if (/\d[\d\s-]{5,}\d/.test(text)) return '';
  return text;
}

// Стадии, где разговор уже про деньги: человек согласился, платит или
// заплатил. Здесь модели можно взять и резервную модель лесенки — ту, что
// отложена под платную рекламу. В остальных — «сколько стоит?», «ещё
// актуально?», «жумуш барбы» — нет: таких сообщений больше всего, и выбрали бы
// они резерв раньше, чем до него дойдёт оплаченное объявление. Без модели
// разговор не встанет — его поймут правила (byRules).
const PAID_STAGES = ['awaiting_payment', 'awaiting_text', 'checking', 'publishing'];

async function classify({ history, stage, text }) {
  try {
    const raw = await extract.complete(system(), transcript(history, stage, text), {
      maxTokens: 700,
      kind: PAID_STAGES.includes(stage) ? 'ad' : 'background',
    });
    const intent = INTENTS.includes(raw.intent) ? raw.intent : 'other';
    return {
      intent,
      lang: raw.lang === 'ky' ? 'ky' : 'ru',
      adText: String(raw.ad_text || '').trim(),
      forbidden: raw.forbidden === true,
      answer: intent === 'question' ? safeAnswer(raw.answer) : '',
    };
  } catch (err) {
    console.error(`[директ] модель не ответила (${err.message}) — понимаю по словам`);
    return byRules(text);
  }
}

// Сколько неудачных чеков подряд терпим, прежде чем отдать проверку админу:
// после второго отказа спорить с человеком дальше — терять клиента.
const MAX_RECEIPT_FAILS = 2;

// Что ответить и куда двигать разговор. Чистая функция: на входе состояние
// разговора и то, что пришло, на выходе — реплики, новая стадия и действия.
//
// state: { stage, hasText, hasImage, fails, mbank }
// ev:    { intent, adText, forbidden, answer, photo, receipt: { ok, reason } | { review: true } }
//
// Действия: publish — выложить рекламу; review — отдать чек админу; paid —
// прислать админу копию принятого чека; handoff — позвать админа в разговор;
// noMbank — сказать админу, что номер для оплаты не задан; forbidden — сказать
// админу об отказе; reset — начать новую рекламу с чистого листа.
function decide(state, ev) {
  const out = { say: [], stage: state.stage, actions: [], fails: state.fails || 0 };
  const say = (key, vars) => out.say.push({ key, vars });
  const act = (name) => out.actions.push(name);
  const done = ['published', 'declined'].includes(state.stage);
  const got = Boolean(ev.adText) || Boolean(ev.photo);
  // Новая реклама после вышедшей — со своим текстом: старый выкладывать
  // второй раз нельзя.
  const fresh = done && Boolean(got || ev.receipt || ['ad', 'agree', 'paid'].includes(ev.intent));
  if (fresh) {
    act('reset');
    out.fails = 0;
  }
  const hasText = (fresh ? false : state.hasText) || Boolean(ev.adText);
  const hasContent = hasText || (fresh ? false : state.hasImage) || Boolean(ev.photo);

  // «Запрещено» имеет смысл только у объявления: вопрос про вакансию модель
  // иногда тоже помечает, и отказывать в ответ на «номер?» было бы странно.
  if (ev.forbidden && (ev.adText || ['ad', 'agree'].includes(ev.intent))) {
    say('forbidden');
    act('forbidden');
    // Уже заплатили — возвращать деньги решает человек, а не бот.
    if (state.stage === 'awaiting_text') act('handoff');
    out.stage = 'declined';
    return out;
  }

  // Второй чек, пока первый на проверке или реклама уже выходит, ничего не
  // меняет — но промолчать в ответ на него нельзя.
  if (ev.receipt && ['publishing', 'checking'].includes(state.stage)) {
    say(state.stage === 'checking' ? 'stillChecking' : 'stillPublishing');
    return out;
  }

  // Чек важнее всего остального в сообщении: ради него человек и пишет.
  if (ev.receipt) {
    if (ev.receipt.review) {
      say('checking');
      act('review');
      out.stage = 'checking';
      return out;
    }
    if (ev.receipt.ok) {
      act('paid');
      out.fails = 0;
      if (hasContent) {
        say('paidPublishing');
        act('publish');
        out.stage = 'publishing';
      } else {
        say('paidNeedText');
        out.stage = 'awaiting_text';
      }
      return out;
    }
    out.fails += 1;
    if (out.fails >= MAX_RECEIPT_FAILS) {
      say('checking');
      act('review');
      out.stage = 'checking';
      return out;
    }
    say('receiptBad', { reason: ev.receipt.reason });
    if (!['awaiting_payment'].includes(state.stage)) out.stage = 'awaiting_payment';
    return out;
  }

  const intent = ev.intent || (got ? 'content' : null);
  if (!intent || intent === 'other') {
    // Картинку без подписи на поздних стадиях всё равно надо принять.
    if (!got) return out;
  }
  if (intent === 'job') {
    say('job');
    return out;
  }
  if (intent === 'human') {
    say('handoff');
    act('handoff');
    return out;
  }
  if (intent === 'question' && !ev.answer) {
    // Ответить по фактам модель не смогла — честнее позвать человека.
    say('handoff');
    act('handoff');
    return out;
  }

  // Заявка «это вообще реклама?» с текстом объявления внутри — это и есть
  // присланное объявление.
  const effective = intent === 'ad' && got ? 'content' : intent === 'other' ? 'content' : intent;

  switch (fresh ? 'new' : state.stage) {
    case 'new':
    case 'offered':
    case 'published':
    case 'declined': {
      if (effective === 'decline') {
        say('decline');
        out.stage = 'declined';
        break;
      }
      if (effective === 'agree' || effective === 'paid') {
        if (effective === 'paid') say('askReceipt');
        else if (state.mbank) say('payment', { needText: !hasContent });
        else {
          say('noMbank');
          act('noMbank');
        }
        out.stage = 'awaiting_payment';
        break;
      }
      if (effective === 'question') {
        say('answer', { text: ev.answer });
        break;
      }
      if (effective === 'greeting' && state.stage !== 'offered') {
        say('greeting');
        break;
      }
      // Реклама, присланное объявление, повторное «сколько стоит».
      if (state.stage === 'offered' && !fresh) say(got ? 'gotContentOffer' : 'offer');
      else say('offer', { got });
      out.stage = 'offered';
      break;
    }
    case 'awaiting_payment': {
      if (effective === 'decline') {
        say('decline');
        out.stage = 'declined';
      } else if (effective === 'paid') say('askReceipt');
      else if (effective === 'question') say('answer', { text: ev.answer });
      else if (effective === 'content') say('gotContentWait');
      else say(state.mbank ? 'waitReceipt' : 'noMbank');
      break;
    }
    case 'awaiting_text': {
      if (effective === 'content' && hasContent) {
        say('publishingNow');
        act('publish');
        out.stage = 'publishing';
      } else if (effective === 'question') say('answer', { text: ev.answer });
      else if (effective === 'decline') {
        // Деньги уже у нас — отказ разбирает админ.
        say('handoff');
        act('handoff');
      } else say('paidNeedText');
      break;
    }
    case 'checking':
      if (effective === 'question') say('answer', { text: ev.answer });
      else say('stillChecking');
      break;
    case 'publishing':
      if (effective === 'question') say('answer', { text: ev.answer });
      else say('stillPublishing');
      break;
    default:
      break;
  }
  return out;
}

module.exports = { classify, decide, byRules, safeAnswer, guessLang, transcript, INTENTS, MAX_RECEIPT_FAILS };
