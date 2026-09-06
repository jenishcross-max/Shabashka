const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const EMPLOYMENT_TYPES = require('../employmentTypes');
const EXPERIENCE_LEVELS = require('../experienceLevels');

const EMPLOYMENT_VALUES = EMPLOYMENT_TYPES.map((t) => t.value);
const EXPERIENCE_VALUES = EXPERIENCE_LEVELS.map((t) => t.value);

// Куда объявление уйдёт: заказ и вакансия — карточки на сайте, board — записка
// на доске (продажа, аренда, свои услуги), other — мусор, который не публикуется.
const LISTING_TYPES = ['order', 'vacancy', 'board', 'other'];

// Разбор пересланного текста объявления в поля заказа, вакансии или записки.
//
// Регулярками это не берётся: «нужен сантехник срочно ор чуй 8й мкр 2000с» —
// обычная форма записи в чатах, где нет ни знаков препинания, ни порядка полей,
// а половина сообщений вообще не объявления. Поэтому здесь модель, а не
// парсер: она же отсеивает болтовню флагом is_listing.
//
// В одном сообщении может быть несколько объявлений подряд (автор рассылает
// пачкой) — модель возвращает массив, а не одно объявление.
//
// Картинки мы больше не читаем. Раньше сюда приходили скриншоты из WhatsApp, и
// зрение стоило дорого: сама картинка — ровно 2048 токенов независимо от
// размера, плюс правила про ленту чата и интерфейс мессенджера в промпте, плюс
// ужатие через canvas и ступени на «Request too large». Отказались осознанно:
// объявления в этих чатах пишут текстом, а суточная норма токенов — то, во что
// мы упираемся, — от одной картинки худела вдвое. Модели без зрения при этом
// открыты все, а не только Qwen.
//
// Groq — бесплатный тариф без карты и без региональных ограничений
// (в отличие от Gemini, который в Кыргызстане выдаёт квоту 0).
// Ключ берётся на https://console.groq.com/keys.
//
// Лимитов у него два, и мешать их нельзя: 8000 токенов в минуту и 200 000 в
// сутки, оба на организацию. Минутный виден в заголовках ответа, по ним и
// держим темп; суточный не виден нигде, его считаем сами (см. spend ниже).
// Можно подключить второй шлюз (FALLBACK_API_URL — любой сервис с форматом
// OpenAI: OmniRoute, OpenRouter, Gemini через OpenAI-совместимый адрес). Он не
// заменяет Groq, а подхватывает перелив: когда у всех ключей Groq минутный
// лимит выбран, разбор уходит туда. См. выбор дорожки в pickLane.
const GROQ = {
  name: 'Groq',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
  // Чем разбирать, если не устраивает GROQ_MODEL. Минутный лимит сменой модели
  // не поднять — у всех обычных моделей Groq он одинаковый, 8000 на
  // организацию. Исключение одно: groq/compound с его 70000 в минуту (правда,
  // всего 250 запросов в сутки и с собственным веб-поиском внутри). Зрение
  // больше не требуется, поэтому выбор не ограничен зрячими моделями.
  textModel: process.env.GROQ_TEXT_MODEL || '',
  reasoning: process.env.GROQ_REASONING || 'none',
  tokensField: 'max_completion_tokens',
  // Groq присылает остаток минутного лимита в заголовках — по ним и держим темп.
  paced: true,
};

// Groq не даёт текстовым моделям строгий response_format: json_schema на всех
// моделях подряд — структуру описываем прямо в системном промпте.
//
// Промпт короткий не для красоты: Groq считает его в минутный лимит целиком, и
// каждая лишняя тысяча знаков отнимает место у самого объявления. Правила
// оставлены все, вырезаны повторы и объяснения, которые модели ничего не
// добавляли.
function buildSystem(categories) {
  return [
    'Ты разбираешь объявления из чатов Кыргызстана (WhatsApp, Telegram) в структуру для доски объявлений «Шабашка».',
    '',
    'Всё, что ты вернёшь с is_listing = true, публикуется на сайте сразу, без человека. Поэтому по каждому сообщению сначала ответь: это объявление — кто-то что-то предлагает или ищет, и названо, что именно? Нет или непонятно — is_listing = false. Пропустить сомнительное правильнее, чем опубликовать лишнее.',
    'В сообщении может быть несколько объявлений подряд — верни каждое отдельным элементом массива и не объединяй разные сообщения в одно.',
    '',
    'Верни только JSON, без markdown и пояснений:',
    '{"listings":[{"is_listing":boolean,"listing_type":"order"|"vacancy"|"board"|"other","title":string,"description":string,"category":string,"city":string,"address":string,"budget":string,"phone":string,"work_format":"online"|"offline","employment_type":string,"experience":string,"note":string}]}',
    '',
    'Отбор:',
    '- Язык не меняй: кыргызский текст — кыргызские title и description, русский — русские. Правь только опечатки и пунктуацию.',
    '- is_listing = false для переписки: приветствия («ассалам алейкум», «salam», «+», «кто свободен?»), благодарности, споры, новости, опросы.',
    '- is_listing = false для запрещённого, даже оформленного объявлением: наркотики и «закладки», мошенничество и лёгкие деньги без объяснения работы, ставки и казино, займы под проценты, обмен валют, сбор денег, документы и дипломы, интим-услуги, оружие, продажа аккаунтов и сим-карт.',
    '- is_listing = false для сетевого маркетинга и «работы в офисе» без профессии — самый частый мусор в этих чатах, и по форме он выглядит как образцовая вакансия: график 5/2 или 6/1, «10:00-17:00», «от 17 до 28 лет», «опыт не важен, всему научим», «өзүбүз үйрөтөбүз», «карьерный рост», «мест ограничено», «требования: ответственность, активдуу». Решающий признак один: НЕ НАЗВАНО, КЕМ РАБОТАТЬ («требуются женщины и мужчины», «жаштар керек», «биз сизди күтөбүз»). Настоящая вакансия называет профессию: повар, сварщик, продавец, водитель, официант, кассир — и тогда график с обучением ей не мешают. Не названа — is_listing = false, в note «не указана должность».',
    '- Сюда же прямая вербовка в сеть: «сетевой бизнес», «ищу партнёров в команду», «международная компания», Атоми, Орифлейм, Эйвон, Гринвей, «финансовая свобода», «пассивный доход». Там платят за приведённых людей, а не за работу. Продажа товара из каталога («продаю крем Орифлейм, 500с») — обычное объявление, board.',
    '- is_listing = false для вербовки девушек под видом уборки или помощи по дому: так пишут сутенёры. Признак — НЕ НАЗВАНО, ГДЕ И ЧТО ДЕЛАТЬ: у настоящей уборки есть объект (квартира после ремонта, дом, офис, кафе, подъезд) и обычно район. Объекта нет — смотри остальное: зовут только девушек («кыздар», «келиндер»); деньги сразу и наличными («акчасы налчи сразу берем», «жакшы толонот»); вместо адреса встреча или ориентир («Ош базар жактан»); зовут писать в личку («жазгыла лчка»); названы возраст и внешность; за простую работу платят заметно больше обычного. Нет объекта плюс хоть один признак — is_listing = false, note «похоже на вербовку». «Нужна уборщица в кафе на Чуй» — объект назван, объявление обычное.',
    '- Сомневаешься между true и false — ставь false и коротко объясни в note.',
    '',
    'Тип:',
    '- "order" — заказчику нужен исполнитель на разовую работу, в том числе стройка и шабашка.',
    '- "vacancy" — постоянная или сменная работа с работодателем, графиком или окладом. Сомневаешься между order и vacancy — ставь order: в этих чатах в основном разовые заказы.',
    '- "board" — всё остальное, что всё-таки объявление: продажа (дом, машина, вещи, стройматериалы), сдача и поиск жилья, свои услуги («сантехник, все виды работ», «бригада делает ремонт под ключ»), поиск работы для себя, грузоперевозки и такси, находки и пропажи, реклама школы, курсов, салона, магазина. Разница с order простая: заказчику нужен человек — order; человек предлагает себя, свой товар, жильё или свои услуги — board.',
    '- "other" — только мусор и запрещённое, там же is_listing = false.',
    '',
    'Поля:',
    `- category — строго из списка: ${categories.join(', ')}. Ничего не подходит — «Другое».`,
    `- city — если город не назван, но упомянут район Бишкека (Аламедин, Восток-5, Джал, мкр, Тунгуч, Асанбай), ставь «Бишкек». Известные города: ${KNOWN_CITIES.join(', ')}.`,
    '- address — только район или микрорайон, без номера дома, подъезда и квартиры.',
    '- budget — число в сомах: у заказа цена работы, у вакансии нижняя граница зарплаты, у board цена предмета. «2000с», «2 000 сом», «2к» → 2000. Вилка — нижняя граница. «Договорная» — пусто.',
    '- phone — в формате +996XXXXXXXXX: «0700 123 456» → «+996700123456».',
    '- work_format — "online" только для удалённой работы (дизайн, тексты, программирование), всё физическое — "offline".',
    `- employment_type (${EMPLOYMENT_VALUES.join(', ')}) и experience (${EXPERIENCE_VALUES.join(', ')}) — только для вакансий и только если сказано явно, иначе пусто.`,
    '- Ничего не выдумывай: нет поля в тексте — пустая строка. Описание бери из сообщения, а не сочиняй по заголовку.',
    '',
    'Перед ответом по каждому элементу с is_listing = true проверь: понятно, что предлагают или ищут? если заказ или вакансия — названа профессия, а не только график и возраст? если зовут девушек на уборку — назван объект? нет ли здесь запрещённого? Хоть один ответ «нет» — ставь is_listing = false.',
  ].join('\n');
}

// Кыргызские номера пишут как придётся: «0700 123 456», «996700123456»,
// «+996 (700) 12-34-56». Модель просят привести их к +996XXXXXXXXX, но
// иногда она переписывает номер как есть, а кнопка WhatsApp на сайте с таким
// номером не откроется — поэтому приводим сами, не полагаясь на модель.
function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? `+996${digits}` : null;
}

// Есть ли в тексте что-то похожее на телефон. Нужна не для разбора, а для
// отсева до него: объявление без номера бот всё равно не публикует (откликнуться
// было бы некуда — см. handleParsed в bot.js), а бесплатный Groq пропускает
// около одного разбора в минуту на ключ. Гонять на такие сообщения модель —
// значит держать очередь занятой ради заведомого отказа.
// Порог мягкий: девять цифр подряд (с любыми разделителями внутри) — это уже
// либо номер, либо что-то, что модель разберёт в номер. Цена ошибки
// несимметрична: лишний разбор стоит минуты очереди, пропущенное объявление —
// самого объявления.
function hasPhone(text) {
  for (const chunk of String(text ?? '').match(/\d[\d\s()+\-.]{6,}\d/g) || []) {
    if (chunk.replace(/\D/g, '').length >= 9) return true;
  }
  return false;
}

// Первый номер из текста — для рекламы, которую публикуем как есть, без модели
// (см. publishRawAd в bot.js). Ищем тем же мягким шаблоном, что и hasPhone, но
// возвращаем номер в том виде, в каком его ждёт сайт.
function phoneFrom(text) {
  for (const chunk of String(text ?? '').match(/\d[\d\s()+\-.]{6,}\d/g) || []) {
    const phone = normalizePhone(chunk);
    if (phone) return phone;
  }
  return null;
}

function normalize(raw) {
  const clean = (v) => String(v ?? '').trim();
  const budgetDigits = clean(raw.budget).replace(/\D/g, '');
  const employmentType = clean(raw.employment_type);
  const experience = clean(raw.experience);
  const listingType = clean(raw.listing_type);

  return {
    is_listing: Boolean(raw.is_listing),
    listing_type: LISTING_TYPES.includes(listingType) ? listingType : 'order',
    title: clean(raw.title).slice(0, 120),
    description: clean(raw.description),
    category: clean(raw.category),
    city: clean(raw.city),
    address: clean(raw.address).slice(0, 200) || null,
    budget: budgetDigits ? Number(budgetDigits) : null,
    phone: normalizePhone(raw.phone),
    work_format: raw.work_format === 'online' ? 'online' : 'offline',
    employment_type: EMPLOYMENT_VALUES.includes(employmentType) ? employmentType : 'gig',
    experience: EXPERIENCE_VALUES.includes(experience) ? experience : 'no_experience',
    note: clean(raw.note),
  };
}

// Жадный regex /\{[\s\S]*\}/ иногда захватывает лишний текст после самого
// JSON (модель добавляет пояснение после закрывающей скобки) — вместо этого
// ищем первый сбалансированный объект, считая скобки и не сбиваясь на них
// внутри строк.
function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Модель переписывает объявление слово в слово, а в кыргызстанских объявлениях
// обратный слэш стоит через раз: «2300-2600 с\смена», «график 2\2, 3\1, 5\2».
// В JSON одиночный слэш перед буквой — недопустимая escape-последовательность,
// и JSON.parse валит весь ответ целиком: разобранное объявление теряется, а
// оплаченная реклама уходит на доску запасным путём вместо своего раздела.
// Просить модель экранировать бесполезно — она копирует текст как видит.
// Поэтому чиним ответ сами: одиночные слэши удваиваем, живые переводы строк
// внутри строки экранируем.
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const CONTROL_ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

function repairJson(json) {
  let out = '';
  let inString = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = json[i + 1];
      // \uXXXX без четырёх шестнадцатеричных — такой же мусор из текста.
      const hex = next === 'u' && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6));
      if (hex || VALID_ESCAPES.has(next)) {
        out += ch + next;
        i++;
      } else {
        out += '\\\\';
      }
      continue;
    }
    out += CONTROL_ESCAPES[ch] || (ch < ' ' ? ' ' : ch);
  }
  return out;
}

const RETRIES = 2;
const MAX_WAIT_MS = 40000;
// Граница между «минутный лимит» и «суточный»: до неё ждём на месте, дальше
// считаем дорожку выбывшей до названного часа и берём другую.
const MINUTE_LIMIT_MAX_MS = 5 * 60 * 1000;

// Потолок ответа по умолчанию. Groq считает его в минутный лимит целиком, ещё
// до того как модель что-то ответила, — то есть это не «сколько разрешим», а
// «сколько заранее заняли» (см. TEXT_STEPS).
const DEFAULT_MAX_TOKENS = 2000;

// Один разбор весит около 4500 токенов при лимите 8000 в минуту: промпт (~2200),
// сам текст объявления и зарезервированный ответ (2000) — Groq считает всё это
// заранее, ещё до самого ответа. Пока читали и картинки, выходило вдвое дороже:
// одна картинка стоила ровно 2048 токенов независимо от размера, плюс правила
// про скриншот в промпте. Отсюда и шаг очереди PACE_MS — по нему бот считает,
// когда доберётся до пачки. Точное ожидание всё равно берётся из заголовков с
// остатком лимита.
const PACE_MS = 35000;
const COST_ESTIMATE = 4500;
const MAX_CAPACITY_WAIT_MS = 70000;

// Суточный расход токенов. Упираемся мы на самом деле в него, а не в минуту:
// у бесплатного Groq это 200 000 на организацию в сутки, и в заголовках его,
// в отличие от минутного, нет вовсе — узнать остаток можно, только посчитав
// самому. Считаем по UTC-суткам: по ним Groq суточные квоты и обнуляет.
// Счётчик живёт в памяти процесса, так что после перезапуска Render он занижен;
// это не страшно — он нужен, чтобы видеть порядок величины, а не для решений.
const TOKENS_PER_DAY = Number(process.env.GROQ_DAILY_TOKENS || 200000);
const spent = { day: null, tokens: 0, calls: 0 };

const utcDay = () => new Date().toISOString().slice(0, 10);

function spend(data) {
  if (spent.day !== utcDay()) {
    spent.day = utcDay();
    spent.tokens = 0;
    spent.calls = 0;
  }
  spent.calls += 1;
  // Точное число Groq присылает в самом ответе. Нет его (чужой шлюз может и не
  // прислать) — кладём свою прикидку: лучше приблизительно, чем ноль.
  const used = Number(data && data.usage && data.usage.total_tokens);
  spent.tokens += Number.isFinite(used) && used > 0 ? used : COST_ESTIMATE;
}

// Для /stats. Суточную норму умножаем на число ключей Groq — но верно это
// только если ключи с РАЗНЫХ аккаунтов: норма считается на организацию, и два
// ключа одного аккаунта делят одну на двоих. Запасной шлюз в счёт не идёт,
// у него свои правила.
function usage() {
  const fresh = spent.day === utcDay();
  return {
    tokens: fresh ? spent.tokens : 0,
    calls: fresh ? spent.calls : 0,
    limit: TOKENS_PER_DAY * groqLanes.length,
    keys: groqLanes.length,
  };
}

// Несколько бесплатных ключей — несколько независимых минутных лимитов:
// GROQ_API_KEY может содержать один ключ или несколько через запятую, и тогда
// они работают по очереди (round robin), каждый по своему графику. У каждого
// ключа свой остаток лимита и своё время последнего звонка — их нельзя мешать
// в одну переменную, иначе пауза считалась бы так, будто ключ один.
const splitKeys = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

// Адрес запасного шлюза можно вписать как угодно: «http://host:20128»,
// «.../v1» или сразу «.../v1/chat/completions» — дописываем недостающее сами,
// чтобы опечатка в переменной окружения не выглядела как «шлюз не работает».
function completionsUrl(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (url.endsWith('/chat/completions')) return url;
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

const FALLBACK_URL = completionsUrl(process.env.FALLBACK_API_URL);
// Без названия модели шлюз не поднимаем: у OmniRoute их сотни, «по умолчанию»
// там ничего нет, и запрос отбился бы на каждом объявлении. Лучше честно
// сказать об этом один раз в лог при старте и продолжить на одном Groq.
if (FALLBACK_URL && !process.env.FALLBACK_MODEL) {
  console.error('[extract] FALLBACK_API_URL задан, а FALLBACK_MODEL — нет: запасной шлюз выключен');
}
const FALLBACK = FALLBACK_URL && process.env.FALLBACK_MODEL
  ? {
      name: process.env.FALLBACK_NAME || 'запасной шлюз',
      url: FALLBACK_URL,
      model: process.env.FALLBACK_MODEL,
      // reasoning_effort понимают не все — по умолчанию не отправляем вовсе.
      reasoning: process.env.FALLBACK_REASONING || '',
      // max_tokens понимают все, max_completion_tokens — только новые. У шлюза
      // на той стороне может стоять что угодно, поэтому берём совместимое имя.
      tokensField: 'max_tokens',
      // Заголовков с остатком минутного лимита у чужого шлюза может не быть,
      // да и лимит там обычно по запросам, а не по токенам — темп не держим,
      // на 429 просто ждём столько, сколько скажут в ответе.
      paced: false,
    }
  : null;

// Дорожка — это «провайдер + ключ»: у каждого ключа свой независимый лимит и
// своё время последнего звонка, мешать их в одну переменную нельзя, иначе
// пауза считалась бы так, будто ключ один. GROQ_API_KEY и FALLBACK_API_KEY
// могут содержать несколько ключей через запятую — тогда дорожек столько же.
const groqLanes = splitKeys(process.env.GROQ_API_KEY).map((key) => ({
  provider: GROQ,
  key,
  budget: null,
  lastCallAt: 0,
}));

// Ключ у запасного шлюза может быть и не нужен: OmniRoute, поднятый локально,
// пускает без авторизации. Поэтому при заданном адресе дорожка появляется даже
// с пустым ключом — тогда просто не шлём заголовок Authorization.
const fallbackLanes = FALLBACK
  ? (splitKeys(process.env.FALLBACK_API_KEY).length
      ? splitKeys(process.env.FALLBACK_API_KEY)
      : ['']
    ).map((key) => ({ provider: FALLBACK, key, budget: null, lastCallAt: 0 }))
  : [];

// Сколько разборов можно вести одновременно (см. queue.js): по одному на дорожку.
const KEY_COUNT = groqLanes.length + fallbackLanes.length;

// Пишем расклад при старте: иначе опечатку в GROQ_API_KEY (лишний пробел,
// потерянная запятая) никак не увидеть — бот молча работал бы на одном ключе,
// вдвое медленнее, и выглядело бы это просто как «что-то тормозит».
console.log(
  `[extract] дорожек разбора: ${KEY_COUNT} — Groq ${groqLanes.length} ключ(а/ей)` +
    (fallbackLanes.length ? `, ${FALLBACK.name} (${FALLBACK.model})` : ', запасного шлюза нет')
);

let groqTurn = 0;
let fallbackTurn = 0;
const nextGroq = () => groqLanes[groqTurn++ % groqLanes.length];
const nextFallback = () => fallbackLanes[fallbackTurn++ % fallbackLanes.length];

// Какую дорожку взять под этот разбор. Groq — первый: он проверен на кыргызском
// и русском тексте с фотографий. Уходим на запасной шлюз только тогда, когда
// ждать Groq пришлось бы по-настоящему: ни у одного его ключа не осталось
// минутного лимита.
function pickLane() {
  if (!groqLanes.length) return fallbackLanes.length ? nextFallback() : null;
  // По кругу, а не find по списку: иначе при двух свободных ключах оба
  // одновременных разбора ушли бы в первый.
  for (let i = 0; i < groqLanes.length; i += 1) {
    const lane = nextGroq();
    if (waitMs(lane) === 0) return lane;
  }
  if (fallbackLanes.length) return nextFallback();
  return nextGroq();
}

// Порядок обхода дорожек для одного разбора: выбранная первой, затем все
// остальные — начиная с тех, у кого лимит свободен прямо сейчас.
function lanesFrom(first) {
  const rest = [...groqLanes, ...fallbackLanes]
    .filter((lane) => lane !== first)
    .sort((a, b) => waitMs(a) - waitMs(b));
  return [first, ...rest];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// «7.66s», «2m59.56s», «500ms» — формат заголовков x-ratelimit-reset-*.
// Часы нужны для суточного лимита: он отпускает через «1h23m45.6s», и без
// разбора часов такой ответ выглядел бы как «срок неизвестен».
function parseDuration(value) {
  if (!value) return null;
  const text = String(value).trim();

  const ms = /^(\d+(?:\.\d+)?)ms$/.exec(text);
  if (ms) return Number(ms[1]);

  const parts = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
  if (!parts || !parts.slice(1).some((v) => v !== undefined)) return null;
  const [, h = 0, m = 0, sec = 0] = parts;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000;
}

function readBudget(state, res) {
  state.lastCallAt = Date.now();
  const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
  const reset = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  state.budget = Number.isFinite(remaining) && reset !== null
    ? { remaining, resetAt: Date.now() + reset }
    : null;
}

// Сколько миллисекунд пришлось бы ждать перед запросом по этой дорожке. Groq
// присылает остаток минутного лимита в заголовках — по ним пауза выходит ровно
// такой, какая нужна, и при свободном лимите её нет совсем. Если заголовков в
// ответе не оказалось, держим фиксированный шаг: лучше подождать лишнее, чем
// ловить 429 на каждом втором скриншоте.
//
// Отдельной функцией, а не сразу сном: по этому же числу pickLane решает, не
// пора ли отдать разбор запасному шлюзу вместо ожидания.
function waitMs(state) {
  if (!state.provider.paced) return 0;
  if (!state.lastCallAt) return 0;

  if (state.budget) {
    const left = state.budget.resetAt - Date.now();
    if (left <= 0) return 0;
    if (state.budget.remaining >= COST_ESTIMATE) return 0;
    return Math.min(left + 1000, MAX_CAPACITY_WAIT_MS);
  }

  const since = Date.now() - state.lastCallAt;
  return since < PACE_MS ? PACE_MS - since : 0;
}

async function waitForCapacity(state) {
  // Суточный лимит пережидать бессмысленно: 70 секунд сна его не приблизят, а
  // админ всё это время смотрит в пустой чат. Идём сразу — либо Groq передумал,
  // либо получим внятный отказ без минуты молчания. Пометку о том, что дорожка
  // выбыла, при этом не стираем: по ней выбирается порядок обхода в ask.
  const hopeless = state.budget && state.budget.resetAt - Date.now() > MINUTE_LIMIT_MAX_MS;
  const ms = hopeless ? 0 : waitMs(state);
  if (ms) await sleep(ms);
  // Окно лимита к этому моменту либо пересчитано на той стороне, либо истекло —
  // старый остаток больше ничего не значит.
  if (state.budget && (ms || state.budget.resetAt <= Date.now())) state.budget = null;
}

// Через сколько дорожка снова заработает, по ответу 429. Заголовок retry-after
// Groq присылает не всегда, зато точное время почти всегда есть в тексте
// ошибки («try again in 9.66s», у суточного лимита — «try again in 1h23m45.6s»).
// null — срок неизвестен.
function retryResetMs(res, data) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;

  const message = (data && data.error && data.error.message) || '';
  const match = /try again in ([0-9hms.]+)/i.exec(message);
  return match ? parseDuration(match[1].replace(/\.+$/, '')) : null;
}

// Сколько спать на месте перед повтором по той же дорожке. Минутный лимит
// дешевле переждать здесь, чем занимать второй ключ. А вот суточный отпускает
// через часы — спать столько нельзя, возвращаем 0, и разбор уходит на другую
// дорожку (см. перебор в ask).
function retryDelayMs(res, data) {
  const reset = retryResetMs(res, data);
  if (reset === null || reset > MINUTE_LIMIT_MAX_MS) return 0;

  // Секунда сверху: лимит считается по скользящему окну на стороне Groq,
  // и повтор ровно в названный момент иногда прилетает в тот же отказ.
  return Math.min(reset + 1000, MAX_WAIT_MS);
}

// Один поход к модели по конкретной дорожке. Формат тела — OpenAI chat
// completions, он одинаков и у Groq, и у любого шлюза, который мы можем
// подключить запасным; различия провайдеров собраны в объекте provider.
async function call(lane, system, content, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  const provider = lane.provider;

  const body = JSON.stringify({
    // Зрение больше не нужно, поэтому GROQ_TEXT_MODEL — не «отдельная модель для
    // текста», а просто модель: разбираем мы теперь только текст. Не задана —
    // работает та, что в GROQ_MODEL.
    model: provider.textModel || provider.model,
    temperature: 0,
    // Groq считает запрос в минутный лимит вместе с max_completion_tokens, а не
    // по фактическому ответу: при 4000 один разбор весил 8200 при лимите 8000 и
    // отбивался целиком, сколько ни жди. 2000 хватает примерно на шесть
    // объявлений из одного сообщения; ступени ниже — в TEXT_STEPS.
    [provider.tokensField]: maxTokens,
    // Qwen3.6 — reasoning-модель, и по умолчанию размышления выключены: иначе
    // она пишет длинный блок рассуждений и может не добраться до JSON в пределах
    // max_completion_tokens, а сами рассуждения ещё и съедают минутный лимит.
    // Но отличить заказчика от исполнителя — как раз та задача, где размышления
    // помогают, поэтому GROQ_REASONING=low включает их без правки кода. Если
    // после этого JSON начнёт обрываться — поднимать надо и max_completion_tokens.
    // Пустое значение — поле не отправляем совсем: чужой шлюз может его не знать.
    ...(provider.reasoning ? { reasoning_effort: provider.reasoning } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  });

  const headers = { 'Content-Type': 'application/json' };
  // Локальный OmniRoute пускает без ключа — пустой заголовок ему не нужен.
  if (lane.key) headers.Authorization = `Bearer ${lane.key}`;

  for (let attempt = 0; ; attempt += 1) {
    // Только перед первой попыткой: для повторов паузу диктует сам ответ 429,
    // и ждать вдобавок ещё и по остатку лимита значило бы ждать дважды.
    if (attempt === 0) await waitForCapacity(lane);
    // Отметки темпа до звонка: если запрос отобьют по размеру, их надо будет
    // вернуть на место (см. ниже).
    const pacedAt = lane.lastCallAt;
    const budgetBefore = lane.budget;
    const res = await fetch(provider.url, { method: 'POST', headers, body });
    const data = await res.json().catch(() => null);
    readBudget(lane, res);
    if (res.ok) {
      spend(data);
      return data;
    }

    // Лимит токенов в минуту выбирается двумя скриншотами подряд: один разбор
    // весит около 5к токенов при лимите 8000. Groq в ответе говорит, через
    // сколько станет можно, — проще подождать и повторить, чем отдавать админу
    // ошибку на объявление, которое разобралось бы само через десять секунд.
    // Запомнить, до какого момента дорожка выбыла: иначе следующий разбор
    // выбрал бы её снова и снова упёрся бы в тот же суточный лимит.
    if (res.status === 429) {
      const reset = retryResetMs(res, data);
      if (reset !== null) lane.budget = { remaining: 0, resetAt: Date.now() + reset };
    }

    const wait = res.status === 429 && attempt < RETRIES ? retryDelayMs(res, data) : 0;
    if (!wait) {
      const detail = String((data && data.error && data.error.message) || res.status);
      // «Request too large» — не про скорость, а про размер: ждать бесполезно,
      // столько же попросим и в следующий раз. Говорим, что с этим делать.
      if (/request too large/i.test(detail)) {
        // Такой запрос до модели не дошёл: Groq отбивает его на входе, ничего не
        // считая, — минутный лимит остался нетронутым. Возвращаем отметку темпа
        // назад, иначе повтор с меньшим потолком ответа (см. TEXT_STEPS)
        // просидел бы минуту в waitForCapacity ради паузы, которой не нужно.
        lane.lastCallAt = pacedAt;
        lane.budget = budgetBefore;
        // Числа Groq называет сам («Limit 8000, Requested 9163») — переносим их
        // в ошибку. Без них «слишком большой» на трёхстрочном объявлении звучит
        // как выдумка, а по ним сразу видно, насколько не хватило и стоит ли
        // менять модель.
        const size = /limit (\d+), requested (\d+)/i.exec(detail);
        throw new Error(
          `Запрос слишком большой для минутного лимита модели${
            size ? ` — лимит ${size[1]}, запрошено ${size[2]}` : ''
          }.`
        );
      }
      const err = new Error(`${provider.name}: ${detail}`);
      // Лимит — единственный отказ, который проходит сам собой. Помечаем его и
      // называем срок: по ним бот откладывает объявление до восстановления
      // лимита, вместо того чтобы отдать админу ошибку и забыть (см. park в
      // bot.js). Все остальные отказы — ключ отозвали, модель убрали — ждать
      // бессмысленно, они помечены не будут.
      if (res.status === 429) {
        err.rateLimited = true;
        const reset = retryResetMs(res, data);
        if (reset !== null) err.retryAt = Date.now() + reset;
      }
      throw err;
    }
    await sleep(wait);
  }
}

// Единственное место, где мы ходим к модели. content — текст user-сообщения.
// Возвращает массив разобранных объявлений (обычно один элемент).
async function ask(content, systemSuffix, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  const lane = pickLane();
  if (!lane) throw new Error('Не задан GROQ_API_KEY (или FALLBACK_API_URL)');

  const categories = await categoriesRepo.listNames();
  const base = buildSystem(categories);
  const system = systemSuffix ? `${base}\n\n${systemSuffix}` : base;

  let data;
  let lastErr = null;
  // Самый ранний момент, когда хоть одна дорожка снова заработает. Нужен не
  // здесь, а наверху: разбор, упёршийся в лимит, не теряется, а откладывается
  // до этого времени.
  let retryAt = null;
  // Отказ одной дорожки — не повод терять объявление. Раньше запасной ключ
  // Groq не пробовался вовсе: перебор был написан только для чужого шлюза, а
  // ошибка Groq летела админу сразу. Из-за этого выбранный по кругу ключ с
  // выбранным суточным лимитом отбивал разбор, хотя второй ключ был свободен.
  // Теперь обходим все дорожки: сначала выбранную, потом остальные — самые
  // свободные первыми.
  for (const next of lanesFrom(lane)) {
    if (next !== lane || next.provider !== GROQ) {
      console.log(`[extract] разбираю через ${next.provider.name} (${next.provider.model})`);
    }
    try {
      data = await call(next, system, content, { maxTokens });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // Слишком большой запрос на другой дорожке будет ровно таким же —
      // перебирать их значило бы держать админа лишние минуты ради того же
      // отказа. Эту ошибку отдаём сразу.
      if (/слишком большой/i.test(err.message)) throw err;
      if (err.retryAt) retryAt = retryAt === null ? err.retryAt : Math.min(retryAt, err.retryAt);
      console.error(`[extract] ${next.provider.name} не ответил (${err.message})`);
    }
  }
  if (lastErr) {
    // Ошибку отдаём последнюю, а срок — самый ранний из всех: ждать дольше, чем
    // нужно первой освободившейся дорожке, незачем.
    if (retryAt) {
      lastErr.rateLimited = true;
      lastErr.retryAt = retryAt;
    }
    throw lastErr;
  }

  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Пустой ответ модели');

  // Без response_format модель иногда добавляет пояснение до/после JSON или
  // оборачивает его в markdown — вырезаем сам объект и уже его парсим.
  const json = extractJson(text);
  if (!json) throw new Error(`Модель вернула не JSON: ${text.slice(0, 200)}`);

  // Сначала пробуем как есть: правильный ответ трогать незачем.
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    parsed = JSON.parse(repairJson(json));
    console.log(`[extract] в ответе были неэкранированные слэши — починил (${err.message})`);
  }
  const list = Array.isArray(parsed.listings) ? parsed.listings : [parsed];
  // Сколько объявлений модель разглядела на картинке — по одной этой строке
  // видно, разбор ли потерял объявления или их и правда было столько.
  console.log(`[extract] модель вернула объявлений: ${list.length}`);
  return list.map(normalize);
}

// Оплаченная реклама (см. /ad в bot.js) проходит мимо отсева: фильтр писался
// против мусора из чужих чатов, а это объявление прислал сам админ и за него
// заплачено. Убирать весь фильтр нельзя — запрещённое остаётся запрещённым, а
// разбор по полям нужен ровно тот же, — поэтому не отдельный промпт, а приписка
// к общему.
const AD_SUFFIX = [
  'Это объявление прислал администратор доски: оно оплачено и публикуется в любом случае.',
  'Ставь is_listing = true, а listing_type выбирай как обычно: "order" для разового заказа, "vacancy" для вакансии, иначе "board".',
  'Правила про сетевой маркетинг, «работу без названной профессии» и прочий отсев к нему не применяй — по ним его отбраковывать нельзя.',
  'Исключение одно: запрещённое (наркотики, мошенничество, ставки, займы, документы, оружие, интим-услуги, вербовка девушек под видом уборки или помощи по дому) остаётся запрещённым — для него is_listing = false, как и раньше. За такое объявление могли заплатить точно так же, и это ничего не меняет.',
  'Поля разбирай так же, как в обычном объявлении, и ничего не выдумывай.',
].join('\n');


// Ступени потолка ответа на случай «Request too large»: 2000 — это примерно
// шесть разобранных объявлений, 1200 — три-четыре, 800 — одно-два, и до
// последней доходит только очень длинное сообщение. Ужимать больше нечего:
// картинок мы не шлём, а промпт от объявления к объявлению не меняется.
const TEXT_STEPS = [2000, 1200, 800];

async function fromText(text, { ad = false } = {}) {
  const task = `Разбери объявления из этого сообщения чата:\n\n${text}`;

  let lastErr = null;
  for (const maxTokens of TEXT_STEPS) {
    try {
      return await ask(task, ad ? AD_SUFFIX : undefined, { maxTokens });
    } catch (err) {
      // Подвинуться можно только местом, зарезервированным под ответ.
      // Остальные отказы на второй попытке повторятся один в один.
      if (!/слишком большой/i.test(err.message)) throw err;
      lastErr = err;
      console.error(`[extract] текст не влез с потолком ответа ${maxTokens} — снижаю`);
    }
  }
  console.error('[extract] текст не влезает в минутный лимит даже с урезанным ответом');
  throw new Error(
    // Про «взять модель побольше» тут не советуем: минутный лимит у обычных
    // моделей Groq одинаковый и считается на организацию. Помогает либо другой
    // аккаунт (свой лимит), либо groq/compound с его 70000 в минуту.
    `Объявление не влезает в бесплатный минутный лимит модели (${lastErr.message}). Помогут ключ на другом аккаунте Groq или GROQ_TEXT_MODEL=groq/compound.`
  );
}

module.exports = { fromText, hasPhone, phoneFrom, usage, PACE_MS, KEY_COUNT };
