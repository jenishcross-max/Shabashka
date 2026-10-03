const crypto = require('crypto');
const extract = require('../telegram/extract');
const { mbank, PRICE } = require('./texts');

// Чек об оплате рекламы: что на скриншоте и годится ли он.
//
// Читает картинку зрячая модель Groq (см. VISION_MODEL в extract.js), а решает
// не она, а код ниже: модель только переписывает, что видит, — сумму,
// получателя, время, — а «оплачено или нет» считается правилами. Так ошибка
// модели не превращается в «да, всё верно» на чужом или старом чеке.
//
// Подделать скриншот всё равно можно — поэтому каждый принятый чек бот
// присылает админу, и тот сверяет его с МБанком (см. dm/index.js).

const SYSTEM = [
  'Ты смотришь на картинку, которую прислали в личные сообщения Шабашке (Кыргызстан) в ответ на просьбу оплатить рекламу.',
  'Определи, что это, и перепиши то, что видно. Верни только JSON, без пояснений:',
  '{"kind":"receipt"|"photo"|"other","success":boolean,"amount":number|null,"currency":string,"recipient":string,"account":string,"datetime":string,"operation_id":string,"bank":string}',
  '',
  '- kind: "receipt" — чек, квитанция или экран успешного перевода/платежа из банковского приложения (МБанк, Optima, Бакай, Элсом, О!Деньги, MegaPay и т. п.); "photo" — фото, макет, афиша, скриншот объявления или переписки; "other" — всё остальное.',
  '- success: true, если операция прошла («Успешно», «Выполнено», «Оплачено», «Ийгиликтүү»); false, если отклонена, отменена или «в обработке».',
  '- amount: сумма перевода числом, без комиссии. currency: KGS, если сомы.',
  '- recipient: имя получателя, как написано. account: номер телефона, счёта или карты получателя, как написано (со звёздочками, если скрыт).',
  '- datetime: дата и время операции в виде ГГГГ-ММ-ДД ЧЧ:ММ, если видно.',
  '- operation_id: номер операции или квитанции, если есть.',
  '- Ничего не выдумывай: не видно — пустая строка или null.',
].join('\n');

// Картинка → data URL для модели. Скриншоты приходят из расширения уже
// ужатыми (см. tools/threads-dm), тип определяем по первым байтам.
function dataUrl(buffer) {
  const png = buffer[0] === 0x89 && buffer[1] === 0x50;
  const webp = buffer.slice(8, 12).toString() === 'WEBP';
  const type = png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg';
  return `data:${type};base64,${buffer.toString('base64')}`;
}

const hashOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function inspect(buffer) {
  const raw = await extract.complete(
    SYSTEM,
    [
      { type: 'text', text: 'Что на картинке?' },
      { type: 'image_url', image_url: { url: dataUrl(buffer) } },
    ],
    { vision: true, maxTokens: 400 }
  );
  const clean = (v) => String(v ?? '').trim();
  const amount = Number(String(raw.amount ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
  return {
    kind: ['receipt', 'photo', 'other'].includes(raw.kind) ? raw.kind : 'other',
    success: raw.success !== false,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: clean(raw.currency),
    recipient: clean(raw.recipient),
    account: clean(raw.account),
    datetime: clean(raw.datetime),
    operationId: clean(raw.operation_id),
    bank: clean(raw.bank),
  };
}

// Дата операции из того, что переписала модель. Просили ГГГГ-ММ-ДД, но на
// всякий случай понимаем и ДД.ММ.ГГГГ, как пишут банки Кыргызстана.
function dateOf(text) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const ru = /(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  if (ru) return Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));
  return null;
}

const digits = (s) => String(s || '').replace(/\D/g, '');
// Первое слово имени, строчными: «Жениш Ш.» и «ЖЕНИШ ШАРШЕНОВ» — один человек.
const firstName = (s) => (String(s || '').toLowerCase().match(/[\p{L}]{3,}/u) || [''])[0];

// Сколько дней чек считается свежим. Сутки — мало: человек мог перевести
// вечером, а скриншот прислать утром.
const FRESH_DAYS = 3;

// Годится ли чек. Возвращает { ok, reason, warnings }: reason — почему нет
// (см. REASONS в texts.js), warnings — что проверить не удалось; их видит
// только админ в копии чека.
function verify(check, { now = Date.now(), duplicate = false, price = PRICE, to = mbank() } = {}) {
  const warnings = [];
  if (check.kind !== 'receipt') return { ok: false, reason: 'not_receipt', warnings };
  if (duplicate) return { ok: false, reason: 'duplicate', warnings };
  if (!check.success) return { ok: false, reason: 'not_success', warnings };
  if (check.amount === null) warnings.push('сумму на чеке не разобрать');
  else if (check.amount < price) return { ok: false, reason: 'amount', warnings };

  // Получатель: имя или хвост номера. Номер в чеке часто скрыт звёздочками —
  // «+996 700 *** 456», — поэтому сверяем три последние видимые цифры.
  if (to.number || to.name) {
    const want = digits(to.number);
    const got = digits(check.account);
    const byNumber = want.length >= 3 && got.length >= 3 && want.endsWith(got.slice(-3));
    const name = firstName(to.name);
    const byName = Boolean(name) && firstName(check.recipient) === name;
    if (!byNumber && !byName) {
      if (check.recipient || check.account) return { ok: false, reason: 'recipient', warnings };
      warnings.push('получателя на чеке не видно');
    }
  } else {
    warnings.push('MBANK_NUMBER не задан — получателя не с чем сверить');
  }

  const at = dateOf(check.datetime);
  if (at === null) warnings.push('даты на чеке не видно');
  else if (now - at > FRESH_DAYS * 24 * 3600 * 1000) return { ok: false, reason: 'old', warnings };

  return { ok: true, reason: '', warnings };
}

// Ключи, по которым узнаём повторно присланный чек: сама картинка и номер
// операции (один и тот же чек могут переснять и прислать другим файлом).
function keysOf(buffer, check) {
  const keys = [`img:${hashOf(buffer)}`];
  if (check && check.operationId && digits(check.operationId).length >= 4) keys.push(`op:${check.operationId}`);
  return keys;
}

module.exports = { inspect, verify, keysOf, dateOf, hashOf, FRESH_DAYS };
