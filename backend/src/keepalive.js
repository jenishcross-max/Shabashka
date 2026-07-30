// Бесплатный Render усыпляет сервис после 15 минут без входящих запросов, и
// первый посетитель после простоя ждёт около минуты, пока контейнер поднимется.
// Лечим самым дешёвым способом: сервис сам дёргает свой публичный адрес чаще,
// чем этот таймер успевает дойти до конца.
//
// Важно: разбудить себя так нельзя — у спящего процесса и таймеров нет. Это
// защита от засыпания, а не от сна. Если сервис всё-таки уснул (перезапуск,
// сбой сети), первый посетитель снова подождёт. Чтобы будить и в этом случае,
// нужен внешний пинг (cron-job.org, UptimeRobot) — см. README.
const HEALTH_PATH = '/api/health';

// 12 минут — с запасом от пятнадцатиминутного порога Render: одна потерянная
// попытка ещё не роняет сервис в сон.
const INTERVAL_MS = 12 * 60 * 1000;

// Круглые сутки будить нельзя: в бесплатном плане 750 часов работы в месяц, а
// месяц — это 744 часа, то есть запаса не остаётся вовсе. Поэтому держим сервис
// бодрым в те часы, когда на сайт реально заходят (время бишкекское), а ночью
// пусть спит: первый ночной посетитель подождёт минуту, зато часы не кончатся
// двадцать девятого числа.
const FROM_HOUR = Number(process.env.KEEPALIVE_FROM_HOUR ?? 5);
const TO_HOUR = Number(process.env.KEEPALIVE_TO_HOUR ?? 1);

// Бишкек — UTC+6 круглый год, перехода на летнее время нет.
const BISHKEK_OFFSET = 6;

function bishkekHour(now = new Date()) {
  return (now.getUTCHours() + BISHKEK_OFFSET) % 24;
}

// Окно перешагивает полночь (с 5 утра до 1 ночи), поэтому сравнение двойное.
function inWindow(hour) {
  return FROM_HOUR <= TO_HOUR ? hour >= FROM_HOUR && hour < TO_HOUR : hour >= FROM_HOUR || hour < TO_HOUR;
}

function selfUrl() {
  // RENDER_EXTERNAL_URL Render подставляет сам; KEEPALIVE_URL — на случай
  // другого хостинга. Локально ни того, ни другого нет, и пинговать незачем.
  return (process.env.RENDER_EXTERNAL_URL || process.env.KEEPALIVE_URL || '').replace(/\/$/, '');
}

function start() {
  const base = selfUrl();
  if (!base) return;

  console.log(`Самопинг включён: ${base}${HEALTH_PATH} каждые 12 мин, ${FROM_HOUR}:00–${TO_HOUR}:00 по Бишкеку`);

  const timer = setInterval(() => {
    if (!inWindow(bishkekHour())) return;
    // Промах не логируем: сеть отвалилась — следующая попытка через 12 минут,
    // а шум в логах бесплатного плана только мешает искать настоящие ошибки.
    fetch(`${base}${HEALTH_PATH}`).catch(() => {});
  }, INTERVAL_MS);

  timer.unref(); // процесс держит express, а не этот таймер
}

module.exports = { start, inWindow, bishkekHour };
