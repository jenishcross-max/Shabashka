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
| «POV: ищешь подработку в общем чате» | 12,5 с | `videos/pov-chat/renders/pov-chat.mp4` | `videos/pov-chat/index.html` |
| «Шабашка… ДЕНЬГИ!» (пародия на мем «Вулкан, вулкан…») | 17 с | `videos/shabashka-dengi/renders/shabashka-dengi.mp4` | `videos/shabashka-dengi/index.html` |
| «Ууу, она как будто сериал» — «Зарплата каждый день» (тренд, без песни) | 12,3 с | `videos/serial-zarplata/renders/serial-zarplata.mp4` | `videos/serial-zarplata/index.html` |
| «5 подработок на завтра в Бишкеке» — реальные заказы с плюсами и минусами | 24,2 с | `videos/podrabotki-zavtra/renders/podrabotki-zavtra.mp4` | `videos/podrabotki-zavtra/index.html` |
| «Свободная суббота = 2 000 сом» — 5 подработок недели, плитка 340 000 сом | 23,2 с | `videos/rabota-vyhodnye/renders/rabota-vyhodnye.mp4` | `videos/rabota-vyhodnye/src/rabota.html` → `python src/build.py` |
| «Речевой тренажёр: 3 минуты до собеседования» — настоящие экраны сайта (`src/shots.py`), без музыки | 18 с | `videos/logoped-3min/renders/logoped-3min.mp4` | `videos/logoped-3min/src/logoped.html` → `python src/build.py` |
| «Аудиокниги: лекция в наушниках» — чат, настоящий голос бота, музыка make_audio calm (под голосом приглушена); в финале t.me/Audio_and_Books_bot | 16,6 с | `videos/audiobooks-lekciya/renders/audiobooks-lekciya.mp4` | `videos/audiobooks-lekciya/src/audiobooks.html` → `python src/build.py` |
| «Да ты не искал даже» — трендовый клип (mem.video, зелёный фон) + реальные заказы | 12 с | `videos/ne-iskal/renders/ne-iskal.mp4` | `videos/ne-iskal/index.html` |
| Мемы недели 1 (5 шт.): рабочее время, запросы, резюме, «опыт», грузчик — `tools/meme.py` | 7,6–10,8 с | `videos/meme-*/renders/meme-*.mp4` | `videos/meme-*/index.html` |

Тексты для групп, Threads и Instagram — `posts.md`.

В «ДЕНЬГИ!» голос озвучен в ElevenLabs (Liam, Eleven v3), а картинки сгенерированы Qwen-Image на Hugging Face —
свои, без чужих фото.

«Сериал» — под трендовую песню: она лежит в `assets/song.wav` только для таймингов и для
`renders/serial-zarplata-preview.mp4`. В файл для публикации песня не вшита — её добавляют
в Instagram/TikTok из библиотеки звуков. Видео девушки — Wan 2.2 на Hugging Face.

Сценарии и решения — `docs/superpowers/specs/2026-10-17-promo-videos-design.md`
(«Шабашка» и «Биржа») и `docs/superpowers/specs/2026-10-19-product-videos-design.md`
(пригласительное, Scroll Book, реклама). Экраны в двух последних настоящие:
демо пригласительного снято Playwright-ом с телефонной шириной, Scroll Book — из
скриншотов Play-карточки.

## Студия: новый ролик за пять минут

Для своих роликов есть заготовка — `studio/template`, весёлый ролик в формате «POV»
на 12,5 секунды. Одна команда делает из неё новый проект со своей музыкой под длину:

```bash
cd promo
node studio/new.mjs ozhidanie-realnost        # имя латиницей; настроение: beat, soft, calm
cd videos/ozhidanie-realnost
npm run dev                                   # редактор в браузере
```

Правила, фирменный стиль и десяток идей для роликов — в `CLAUDE.md`. Удобнее всего
вести ролики в отдельной сессии Claude, открытой в папке `promo`: она прочитает
`CLAUDE.md` сама и знает, что можно, а что нельзя.

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
