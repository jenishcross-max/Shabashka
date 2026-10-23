// Встроенные браузеры Threads («Barcelona»), Instagram и Facebook — оттуда на
// сайт приходит большинство людей.
export const IN_APP_RE = /Barcelona|Instagram|FBAN|FBAV|FB_IAB/i;

export const isInApp = () => IN_APP_RE.test(navigator.userAgent);

// На Android встроенный браузер Threads и Instagram прячет свою верхнюю полосу,
// когда страницу листают, и сдвигает при этом всю страницу целиком: её низ то
// уходит за край экрана, то возвращается. Панель, прибитая к низу страницы,
// ездила вместе с ним — то пряталась наполовину, то «застревала» выше края.
// Верх страницы при этом всегда на месте, поэтому там панель — сверху (см.
// .in-app-android в index.css). Класс ставится до первой отрисовки.
export function markInApp() {
  if (isInApp() && /Android/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('in-app-android');
  }
}
