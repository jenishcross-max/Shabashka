// Назад, а если некуда (экран открыли ссылкой или пушем) — на биржу.
export function goBack(router) {
  if (router.canGoBack()) router.back();
  else router.replace('/tasks');
}
