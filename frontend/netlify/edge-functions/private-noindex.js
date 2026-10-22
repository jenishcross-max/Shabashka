// Личные страницы — кабинет, переписка, админка, подтверждение почты — в поиске
// не нужны. Раньше их закрывал robots.txt, но запрет на обход не убирает адрес
// из индекса: Google находил ссылки и держал страницы в поиске без текста
// («Проиндексировано, несмотря на блокировку в файле robots.txt»). Убрать их
// оттуда можно только так: пустить робота и сказать ему noindex заголовком.
export default async (request, context) => {
  const response = await context.next();
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
};

export const config = {
  path: [
    '/my-orders',
    '/my-vacancies',
    '/my-tasks',
    '/my-ads',
    '/messages',
    '/messages/*',
    '/admin',
    '/admin/*',
    '/verify-email',
  ],
};
