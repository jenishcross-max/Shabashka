# Промо-ролики шабашка.com

Вертикальные ролики 9:16 (1080×1920, 30 fps) для Reels / TikTok / Shorts и для
«Моих продуктов» в боте (Reels в Instagram и ролик в Threads).
Сделаны в [HyperFrames](https://github.com/heygen-com/hyperframes): каждый ролик — HTML-страница
с GSAP-анимацией, которую HyperFrames превращает в MP4.

| Ролик | Длина | Готовый файл | Исходник |
|---|---|---|---|
| «Шабашка: выложи — тебе напишут» | 24 с | `videos/shabashka-promo/renders/shabashka-promo.mp4` | `videos/shabashka-promo/index.html` |
| «Биржа: исполнители найдут вас сами» | 26 с | `videos/birzha-promo/renders/birzha-promo.mp4` | `videos/birzha-promo/index.html` |
| «Пригласительное: 300 гостей одной ссылкой» | 24 с | `videos/invite-promo/renders/invite-promo.mp4` | `videos/invite-promo/index.html` |
| «Scroll Book: листай книгу» | 24 с | `videos/scrollbook-promo/renders/scrollbook-promo.mp4` | `videos/scrollbook-promo/index.html` |
| «Реклама в Шабашке: 50 сом — 1000+ просмотров» | 20 с | `videos/ads-promo/renders/ads-promo.mp4` | `videos/ads-promo/index.html` |

Тексты для групп, Threads и Instagram — `posts.md`.

Сценарии и решения — `docs/superpowers/specs/2026-10-17-promo-videos-design.md`
(«Шабашка» и «Биржа») и `docs/superpowers/specs/2026-10-19-product-videos-design.md`
(пригласительное, Scroll Book, реклама). Экраны в двух последних настоящие:
демо пригласительного снято Playwright-ом с телефонной шириной, Scroll Book — из
скриншотов Play-карточки.

## Как поменять и пересобрать

Нужны Node.js 22+ и ffmpeg.

```bash
cd promo/videos/birzha-promo
npx hyperframes preview          # редактор в браузере: текст, тайминги, клипы
npx hyperframes check            # проверка перед рендером
npx hyperframes render --quality delivery --output renders/birzha-promo.mp4
```

Текст в кадре правится прямо в `index.html` (поиск по фразе). Цены и примеры задач — там же.

## Звук

Музыка и звуки свои, без чужих прав: их генерирует `tools/make_audio.py`
(`python3 tools/make_audio.py videos/<ролик>/assets <длина_сек> [beat|soft|calm]`, нужен
numpy): `beat` — бодрый бит (по умолчанию, «Шабашка», «Биржа», реклама), `soft` —
колокольчики для пригласительного, `calm` — спокойная музыка для Scroll Book.

## Шрифты и библиотеки

Rubik и Golos Text (как на сайте, OFL) и GSAP лежат в `assets/` каждого ролика: рендер
не ходит в сеть. `tools/fonts.css.txt` — блок `@font-face`, вставленный в оба `index.html`.
