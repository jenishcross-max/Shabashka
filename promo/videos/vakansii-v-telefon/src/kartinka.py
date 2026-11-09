# Картинка 1080×1350 для ленты (Threads, Instagram, WhatsApp-статус) из тех же стилей, что ролик:
# берёт <style> и логотип из собранного index.html и снимает кадр headless-Chrome от HyperFrames.
# python src/kartinka.py → renders/vakansii-v-telefon.png
import glob, os, re
from playwright.sync_api import sync_playwright
root = 'C:/src/programs/shabashka-kg/promo/videos/vakansii-v-telefon'
built = open(root + '/index.html', encoding='utf-8').read()
style = re.search(r'<style>(.*?)</style>', built, re.S).group(1)
logo = re.search(r'<svg viewBox="0 0 100 100"><rect.*?</svg>', built, re.S).group(0)
ways = re.search(r'(<div id="w1" class="way">.*?)\s*<div class="free">', built, re.S).group(1)

html = f'''<!doctype html><html lang="ru"><head><meta charset="UTF-8" /><style>{style}
  html, body, #root {{ width: 1080px; height: 1350px; }}
  .card {{ position: absolute; inset: 0; padding: 74px 70px 0; }}
  .card .h-xl {{ font-size: 86px; margin-top: 34px; }}
  .card .way {{ margin-top: 34px; padding: 36px 38px 38px; }}
  .card .ico {{ width: 132px; height: 132px; }}
  .card .ico svg {{ width: 74px; height: 74px; }}
  .bottom {{ display: flex; align-items: center; justify-content: space-between; margin-top: 44px; }}
  .bottom .pill {{ font-size: 56px; padding: 10px 46px 16px; }}
  .bottom .brand {{ position: static; font-size: 54px; gap: 18px; }}
  .bottom .brand svg {{ width: 74px; height: 74px; }}
  .card .links {{ margin-top: 30px; font-size: 40px; }}
</style></head><body><div id="root"><div class="card">
  <div class="pill">ИЩЕТЕ РАБОТУ?</div>
  <div class="h-xl"><span class="word">Новые вакансии</span><span class="word">придут сами —</span><span class="word red">вам в телефон</span></div>
  {ways}
  <div class="bottom"><div class="pill">Бесплатно</div><div class="brand">{logo}шабашка.com</div></div>
  <div class="links">Ссылки — в описании и в профиле</div>
</div></div></body></html>'''
page_path = root + '/.kartinka.html'  # рядом с assets/, чтобы шрифты нашлись; после снимка удаляется
open(page_path, 'w', encoding='utf-8').write(html)
chrome = glob.glob(os.path.expanduser('~/.cache/hyperframes/chrome/chrome-headless-shell/*/*/chrome-headless-shell.exe'))[0]
os.makedirs(root + '/renders', exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=chrome)
    pg = b.new_page(viewport={'width': 1080, 'height': 1350})
    pg.goto('file:///' + page_path)
    pg.evaluate('document.fonts.ready')
    pg.wait_for_timeout(300)
    pg.screenshot(path=root + '/renders/vakansii-v-telefon.png')
    b.close()
os.remove(page_path)
print('ok')
