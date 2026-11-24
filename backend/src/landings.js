// Адреса посадочных страниц /rabota/<slug> (исследование 18 октября 2026, см.
// docs/research): под запросы вроде «работа официантом Бишкек» у сайта не было
// ни одной страницы. Тексты и фильтры страниц — во frontend/src/landings.js;
// бэкенду нужны только адреса (sitemap) и категории (подписка в боте).
// Список должен совпадать с фронтендом — это проверяет test/landings.test.js.
module.exports = [
  { slug: 'obshchepit', category: 'Общепит' },
  { slug: 'prodazhi', category: 'Продажи' },
  { slug: 'shveynyy-tseh', category: 'Швейный цех' },
  { slug: 'avtomoyka', category: 'Автомойка, СТО и АЗС' },
  { slug: 'voditel-kurer', category: 'Водители и курьеры' },
  { slug: 'gruzchik', category: 'Склад и грузчики' },
  { slug: 'stroyka', category: 'Стройка и разнорабочие' },
  { slug: 'ohrana', category: 'Охрана' },
  { slug: 'ofis', category: 'Офис' },
  { slug: 'uborka', category: 'Уборка' },
  { slug: 'krasota', category: 'Красота' },
  { slug: 'segodnya', category: null },
  { slug: 'studentam', category: null },
  { slug: 'nochnaya', category: null },
  { slug: 'smennaya', category: null },
  { slug: 'jumush', category: null },
  // Города, страна, «без опыта», «онлайн», «подработка» — поиск 24 ноября 2026.
  { slug: 'kyrgyzstan', category: null },
  { slug: 'bishkek', category: null },
  { slug: 'osh', category: null },
  { slug: 'karakol', category: null },
  { slug: 'naryn', category: null },
  { slug: 'talas', category: null },
  { slug: 'jalal-abad', category: null },
  { slug: 'kara-balta', category: null },
  { slug: 'cholpon-ata', category: null },
  { slug: 'kant', category: null },
  { slug: 'tokmok', category: null },
  { slug: 'batken', category: null },
  { slug: 'bez-opyta', category: null },
  { slug: 'onlayn', category: null },
  { slug: 'podrabotka', category: null },
];
