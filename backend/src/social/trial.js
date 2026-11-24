// Какой ролик-вакансия выходит в Instagram пробным (Trial Reels, см. publishReel
// в instagram.js). 21–22 ноября 2026 ролики-вакансии набирали 44–177 просмотров
// при 3 083 подписчиках, а Threads — около 374 на пост и +143 подписчика за день
// (docs/plans/2026-11-22-whatsapp-instagram-growth.md). Пробный ролик сначала
// показывают только тем, кто на аккаунт не подписан, — проверяем, даст ли это
// новых подписчиков. Число постов не меняется: пробный — тот же ролик.
//
// IG_TRIAL_EVERY — какой по счёту ролик пробный: 2 — каждый второй (по умолчанию,
// так решил владелец 24 ноября 2026: пробные удобно сравнить с обычными), 1 —
// все, off — ни один.
const { parseEvery } = require('./follow');

function create(every) {
  const each = parseEvery(every, 2);
  let reels = 0;
  return function next() {
    if (!each) return false;
    reels += 1;
    return reels % each === 0;
  };
}

const next = create(process.env.IG_TRIAL_EVERY);

module.exports = { create, next };
