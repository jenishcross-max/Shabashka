# Снимает демо сайта-пригласительного покадрово (30 к/с) с подменой часов браузера: вышивка
# на canvas идёт по requestAnimationFrame, поэтому каждый кадр ровный, без рывков записи экрана.
# python capture_invite.py <папка_кадров> → f0000.jpg …; клип собирает ffmpeg.
import glob, math, os, sys
from playwright.sync_api import sync_playwright

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
URL = 'https://rushnik-invitation-demo.web.app/'
FPS = 30
HERO = int(3.0 * FPS)      # вышиваются имена и дата (≈2 с) и короткая пауза
SCROLL = int(6.0 * FPS)    # плавно листаем вниз: отсчёт, история, программа дня
chrome = glob.glob(os.path.expanduser('~/.cache/hyperframes/chrome/chrome-headless-shell/*/*/chrome-headless-shell.exe'))[0]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=chrome)
    ctx = b.new_context(viewport={'width': 390, 'height': 693}, device_scale_factor=1080 / 390,
                        is_mobile=True, has_touch=True, permissions=[], locale='ru-RU')
    page = ctx.new_page()
    page.clock.install()
    page.goto(URL, wait_until='load')
    page.evaluate('document.fonts.ready')
    # куда листать: до программы дня. Блок «Место» не показываем — в демо адрес подмосковный
    target = page.evaluate("(() => { const el = document.querySelector('#program'); return el ? el.getBoundingClientRect().top + scrollY + 60 : 2000; })()")
    n = 0
    for i in range(HERO + SCROLL):
        if i >= HERO:
            k = (i - HERO + 1) / SCROLL
            ease = 0.5 - 0.5 * math.cos(math.pi * k)            # мягкий старт и стоп
            page.evaluate(f'window.scrollTo(0, {target * ease:.1f})')
        page.clock.run_for(round((i + 1) * 1000 / FPS) - round(i * 1000 / FPS))  # целые мс, без накопленной ошибки
        page.screenshot(path=f'{out}/f{n:04d}.jpg', type='jpeg', quality=92)
        n += 1
    b.close()
print('ok', n, 'frames, target', round(target))
