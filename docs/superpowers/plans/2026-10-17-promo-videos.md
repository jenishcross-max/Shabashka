# Промо-ролики шабашка.com — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Два вертикальных MP4-ролика (сайт и Биржа) для Reels/TikTok/Shorts, собранные в HyperFrames.

**Architecture:** Два проекта HyperFrames в `promo/videos/` — `shabashka-promo` и `birzha-promo`.
Каждый — один монолитный `index.html` (корень 1080×1920, сцены — клипы с `data-start`,
одна GSAP-шкала `window.__timelines["main"]`). Шрифты, GSAP и звук лежат локально в
`assets/` каждого проекта: CDN jsdelivr из контейнера закрыт, а рендер не должен ходить в сеть.
Музыка и звуки синтезируются скриптом `promo/tools/make_audio.py` (numpy → WAV).

**Tech Stack:** HyperFrames 0.8.169 (CLI через npx), GSAP 3.14.2, @fontsource Rubik и Golos Text
(кириллица + латиница), Python 3 + numpy, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-17-promo-videos-design.md`

## Global Constraints

- Холст 1080×1920, 30 fps, MP4 (H.264 + AAC).
- Цвета только из `frontend/src/index.css`: `--red #f0433e`, `--red-dark #d62d2a`, `--red-tint #fff1f0`,
  `--bg #fbf7f6`, `--text #241a19`, `--muted #7a6b69`, `--border #efe3e1`, `--green-text #1c8a4a`,
  `--whatsapp #25d366`.
- Шрифты: Rubik (заголовки), Golos Text (текст) — через `@font-face` на локальные файлы.
- Адрес в кадре — «шабашка.com» (так сайт называет себя в README и мета-тегах).
- Без выдуманных цифр о сайте; без обещаний оплаты через площадку; «без комиссии» — можно.
- Текст не ниже y=1640 и не правее x=940 в важных кадрах (интерфейс Reels).
- Никаких сетевых запросов при рендере, никакого `Math.random` без сида.

## Review Focus

- Кириллица рендерится шрифтом Rubik/Golos, а не запасным — проверить снимком, что буквы «ш», «ж» не DejaVu.
- Цифры и «.com» (латиница) тоже из фирменного шрифта — нужен latin-сабсет рядом с cyrillic.
- Длинные строки («Презентация на защиту диплома») влезают в карточку на 1080 px без обрезки.
- Последний кадр каждой сцены виден: конец анимации чуть раньше конца клипа (окно полуоткрытое).
- Звук есть в итоговом MP4 (у каждого `<audio>` есть `id`), музыка затухает к концу.

---

### Task 1: Ассеты

**Files:**
- Create: `promo/tools/make_audio.py`, `promo/tools/fonts.css.txt`
- Create: `promo/videos/*/assets/{gsap.min.js,fonts/*.woff2,music.wav,pop.wav,whoosh.wav}`

- [ ] Скопировать `gsap.min.js` и woff2 (rubik 500/700/800/900, golos-text 400/500/600/700; cyrillic и latin).
- [ ] Написать `make_audio.py`: бит 120 BPM (бочка, хэт, хлопок, бас, аккорды), затухание 1.5 с;
      `pop.wav` 0.15 с и `whoosh.wav` 0.4 с. Длина музыки — аргументом.
- [ ] Проверить: `ffprobe` показывает нужную длительность, пиковый уровень < 0 dBFS.

### Task 2: Ролик «Шабашка» (`shabashka-promo/index.html`, 24 с)

- [ ] Сцены по сценарию 1 спецификации: крючок, сайт + плитки, форма с печатью текста, лента, WhatsApp, финал.
- [ ] `npx hyperframes lint` — 0 ошибок.
- [ ] `npx hyperframes check` — 0 стойких находок.
- [ ] `npx hyperframes snapshot --at <середины сцен>` — проверить глазами каждую сцену.

### Task 3: Ролик «Биржа» (`birzha-promo/index.html`, 26 с)

- [ ] Сцены по сценарию 2: крючок, «Новое», задача, отклики с выбором, смена задач, финал.
- [ ] Те же проверки, что в Task 2.

### Task 4: Рендер и выдача

- [ ] `npx hyperframes render --quality delivery --output renders/<имя>.mp4` для обоих.
- [ ] `ffprobe`: 1080×1920, 30 fps, длительность = `data-duration`, есть аудиодорожка.
- [ ] Вынуть кадры из MP4 (`ffmpeg -ss`) и посмотреть глазами.
- [ ] Коммит и пуш в `claude/wizardly-edison-bdzgtw`.
