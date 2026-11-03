# Собирает videos/rabota-vyhodnye/index.html: шрифты из заготовки, плитка для №1, звуки по таймингам
import re, sys
promo = 'C:/src/programs/shabashka-kg/promo'
src = open(promo + '/videos/rabota-vyhodnye/src/rabota.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))

# №1: 8×6 плиток, кладутся рядами за ~1,4 с
tiles, tiles_js = [], []
for r in range(6):
    for c in range(8):
        n = r * 8 + c
        alt = ' alt' if (r + c) % 2 else ''
        tiles.append(f'<div id="t{n}" class="tile{alt}" style="left: {20 + c * 130}px; top: {410 + r * 130}px"></div>')
tiles_js.append("for (let i = 0; i < 48; i++) tl.fromTo('#t' + i, { opacity: 0, scale: 0.2 }, "
                "{ opacity: 1, scale: 1, duration: 0.18, ease: 'back.out(2)' }, 16.1 + i * 0.028);")

# Звуки — библиотека HyperFrames (Pixabay, можно в рекламе): assets/sfx/, лицензия в CREDITS.md.
# Меньше и тише, чем раньше: переход — короткий «вжух», номер — «поп», цена — «пинг».
sfx = []
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'click': 0.37, 'ping': 1.32,
       'impact-bass-1': 2.12, 'sparkle': 1.8, 'chime': 2.5, 'typing': 1.5}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('pop', 0.5, 0.45, 11); add('click-soft', 1.0, 0.5, 12)
add('whoosh-short', 2.3, 0.4, 13); add('pop', 2.45, 0.4, 11)
for t in (4, 7, 10, 13):
    add('whoosh-short', t - 0.12, 0.35, 13)
    add('pop', t + 0.1, 0.4, 11)
    add('ping', t + 0.45, 0.22, 14)
    add('click-soft', t + 0.95, 0.4, 12)
    add('click', t + 1.65, 0.5, 15)
add('whoosh-short', 15.88, 0.35, 13); add('pop', 16.1, 0.4, 11)
add('typing', 16.15, 0.35, 16)
add('impact-bass-1', 17.6, 0.45, 14)
add('click', 18.75, 0.5, 15); add('pop', 19.0, 0.45, 11)
add('whoosh-short', 20.28, 0.4, 13); add('sparkle', 20.8, 0.3, 16)
sfx.sort(key=lambda s: float(re.search(r'data-start="([\d.]+)"', s).group(1)))
out = (src.replace('/*FONTS*/', fonts).replace('<!--SFX-->', '\n      '.join(sfx))
       .replace('<!--TILES-->', '\n          '.join(tiles)).replace('/*TILES_JS*/', '\n      '.join(tiles_js)))
open(promo + '/videos/rabota-vyhodnye/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx')
