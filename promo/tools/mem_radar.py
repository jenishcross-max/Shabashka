# Радар трендов mem.video: что сейчас в «Популярном», что добавили и какие хуки.
#
#   python tools/mem_radar.py
#
# Пишет trends/mem-<дата>.md: названия и ссылки, 🆕 — новое в топе со
# вчерашнего запуска. Видео не качает: нужный клип владелец скачивает сам
# кнопкой на странице мема. Три запроса за запуск, /api/ и /skachat/ не трогаем
# (их запрещает robots.txt сайта).
import datetime
import html
import pathlib
import re
import urllib.request

SITE = 'https://mem.video'
PAGES = [
    ('Популярное', '/populyarnoe'),
    ('Последние добавленные', '/'),
    ('Хуки и заставки', '/montazh/zastavka'),
]
CARD = re.compile(r'<a class=card__link href=(/mem/[^\s>]+)>\s*<span class=card__title>(.*?)</span>', re.S)

promo = pathlib.Path(__file__).resolve().parent.parent
out_dir = promo / 'trends'
out_dir.mkdir(exist_ok=True)


def cards(path):
    req = urllib.request.Request(SITE + path, headers={'User-Agent': 'shabashka-promo-radar/1.0'})
    for attempt in range(3):  # сайт иногда не успевает с TLS-рукопожатием
        try:
            text = urllib.request.urlopen(req, timeout=30).read().decode('utf-8')
            break
        except OSError:
            if attempt == 2:
                raise
    seen, items = set(), []
    for href, title in CARD.findall(text):
        if href not in seen:
            seen.add(href)
            items.append((html.unescape(re.sub(r'\s+', ' ', title)).strip(), SITE + href))
    return items


# Что было в «Популярном» в прошлый раз — чтобы отметить новое.
previous = sorted(out_dir.glob('mem-*.md'))
today = datetime.date.today().isoformat()
previous = [p for p in previous if p.stem != 'mem-' + today]
old_links = set()
if previous:
    old = previous[-1].read_text(encoding='utf-8').split('## ')[1]
    old_links = set(re.findall(r'\((https://mem\.video/mem/[^)]+)\)', old))

lines = [f'# Тренды mem.video — {today}', '',
         'Клипы чужие (нарезки из фильмов и шоу). Берём с речью, без музыки и без политиков;',
         'скачивает владелец сам кнопкой на странице. 🆕 — новое в топе с прошлого раза.', '']
for name, path in PAGES:
    items = cards(path)
    lines += [f'## {name}', '']
    for i, (title, link) in enumerate(items, 1):
        mark = ' 🆕' if name == 'Популярное' and old_links and link not in old_links else ''
        lines.append(f'{i}. [{title}]({link}){mark}')
    lines.append('')
    print(f'{name}: {len(items)}')

out = out_dir / f'mem-{today}.md'
out.write_text('\n'.join(lines), encoding='utf-8', newline='\n')
print('Готово:', out.relative_to(promo))
