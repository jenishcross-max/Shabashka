// Отклик на бирже без аккаунта (см. guestOffer в backend/src/routes/tasks.js).
// Переписки на сайте у гостя нет: заказчик пишет ему в WhatsApp, а сам гость
// после отправки видит отклик только на этом устройстве — его не спросить, кто он.

export function offerWaLink(phone, taskTitle) {
  const digits = String(phone).replace(/\D/g, '');
  const text = encodeURIComponent(`Здравствуйте! Вы откликнулись на мою задачу «${taskTitle}» на Шабашке.`);
  return `https://wa.me/${digits}?text=${text}`;
}

const key = (taskId) => `guest-offer:${taskId}`;

// В приватном режиме localStorage бросает исключение — тогда просто не помним.
export function rememberGuestOffer(taskId) {
  try {
    localStorage.setItem(key(taskId), '1');
  } catch {
    // не запомнили — после перезагрузки снова покажем форму, сервер не даст отправить второй раз
  }
}

export function sentAsGuest(taskId) {
  try {
    return localStorage.getItem(key(taskId)) === '1';
  } catch {
    return false;
  }
}
