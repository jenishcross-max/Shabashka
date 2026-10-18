# Промо-ролики шабашка.com

Два вертикальных ролика 9:16 (1080×1920, 30 fps) для Reels / TikTok / Shorts.
Сделаны в [HyperFrames](https://github.com/heygen-com/hyperframes): каждый ролик — HTML-страница
с GSAP-анимацией, которую HyperFrames превращает в MP4.

| Ролик | Длина | Готовый файл | Исходник |
|---|---|---|---|
| «Шабашка: выложи — тебе напишут» | 24 с | `videos/shabashka-promo/renders/shabashka-promo.mp4` | `videos/shabashka-promo/index.html` |
| «Биржа: исполнители найдут вас сами» | 26 с | `videos/birzha-promo/renders/birzha-promo.mp4` | `videos/birzha-promo/index.html` |
| Реклама «Вся работа из чатов — в одном месте» | 31 с | `videos/shabashka-ad/renders/shabashka-ad.mp4` | `videos/shabashka-ad/index.html`, сценарий и озвучка — `ad/SCRIPT.md` |

Тексты для групп, Threads и Instagram — `posts.md`.

Сценарии и решения — `docs/superpowers/specs/2026-10-17-promo-videos-design.md`.

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
(`python3 tools/make_audio.py videos/<ролик>/assets <длина_сек>`, нужен numpy).

## Шрифты и библиотеки

Rubik и Golos Text (как на сайте, OFL) и GSAP лежат в `assets/` каждого ролика: рендер
не ходит в сеть. `tools/fonts.css.txt` — блок `@font-face`, вставленный в оба `index.html`.
