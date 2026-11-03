# Настоящие экраны речевого тренажёра шириной телефона (390×844, ×3) для ролика.
# Микрофон не включаем (разрешения нет), часы страницы подкручиваем, чтобы снять
# шаги протокола «3 минуты» без ожидания. История сайта — только в этом браузере.
import glob, os, pathlib
from playwright.sync_api import sync_playwright

URL = 'https://jenishcross2-debug.github.io/logoped/'
out = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'shots'
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    # Свой Chromium у Playwright не скачан — берём headless-shell, который уже есть у HyperFrames
    exe = glob.glob(os.path.expanduser('~/.cache/hyperframes/chrome/chrome-headless-shell/*/*/chrome-headless-shell.exe'))[0]
    b = p.chromium.launch(executable_path=exe)
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True,
                        has_touch=True, locale='ru-RU', color_scheme='light', permissions=[])
    page = ctx.new_page()
    page.clock.install()
    page.goto(URL + '#/rescue', wait_until='networkidle')
    page.clock.run_for(1500)

    def card(name, sel, sel2=None):
        # Только сама карточка (и вторая под ней, если нужна) — вводный текст сайта в кадр не берём
        page.clock.run_for(600)
        r1 = page.locator(sel).first.bounding_box()
        r2 = page.locator(sel2).first.bounding_box() if sel2 else r1
        y0 = r1['y'] + page.evaluate('window.scrollY') - 8
        y1 = r2['y'] + r2['height'] + page.evaluate('window.scrollY') + 8
        page.screenshot(path=str(out / f'{name}.png'), full_page=True,
                        clip={'x': 0, 'y': y0, 'width': 390, 'height': y1 - y0})
        print(name)

    page.screenshot(path=str(out / 'header.png'), clip={'x': 0, 'y': 0, 'width': 390,
                    'height': page.locator('header').first.bounding_box()['height']})
    card('00-rescue-ready', '#rescueCard')
    page.click('#rescueStart')
    page.clock.run_for(2000)
    card('01-reset', '#rescueCard')
    page.clock.run_for(31000)
    card('02-breath', '#rescueCard')
    page.clock.run_for(60000)
    card('03-warmup', '#rescueCard')
    page.clock.run_for(46000)
    card('04-phrase', '#rescueCard')
    page.click('#rescueStop')

    page.goto(URL + '#/phrases', wait_until='networkidle')
    page.clock.run_for(1000)
    page.get_by_role('button', name='Собеседование', exact=True).first.click()
    card('05-phrases-1', '#phraseCats >> xpath=..', '#bigPhrase >> xpath=..')
    page.click('#phraseNext')
    card('06-phrases-2', '#phraseCats >> xpath=..', '#bigPhrase >> xpath=..')
    page.evaluate('window.scrollTo(0, 0)'); page.clock.run_for(300)
    page.screenshot(path=str(out / 'header-phrases.png'), clip={'x': 0, 'y': 0, 'width': 390,
                    'height': page.locator('header').first.bounding_box()['height']})
    b.close()
