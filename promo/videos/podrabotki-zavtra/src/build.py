# Собирает videos/podrabotki-zavtra/index.html: шрифты из заготовки + звуки по таймингам
import re, sys
promo = 'C:/src/programs/shabashka-kg/promo'
src = open(sys.argv[1], encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))
sfx = []
def add(kind, t, vol, track):
    dur = {'pop': 0.15, 'whoosh': 0.45, 'coins': 0.9, 'boom': 0.9}[kind]
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/{kind}.wav" data-start="{t:.2f}" data-duration="{dur}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('boom', 0.45, 0.5, 14); add('pop', 1.2, 0.8, 11)
add('whoosh', 2.45, 0.6, 12); add('pop', 2.65, 0.7, 11)
for t, punch in [(4.4, 1.65), (7.4, 1.65), (10.4, 1.65), (13.4, 1.65), (16.4, 1.35)]:
    add('whoosh', t - 0.15, 0.6, 12)
    add('pop', t + 0.1, 0.7, 11)
    add('coins', t + 0.45, 0.45, 13)
    add('pop', t + 0.95, 0.7, 11)
    add('pop', t + punch, 1.0, 11)
add('pop', 14.15, 0.8, 11); add('pop', 15.25, 0.9, 11)
for t in (18.1, 18.55, 19.0, 19.45):
    add('pop', t, 0.7, 11)
add('boom', 20.05, 0.6, 14)
add('whoosh', 21.05, 0.6, 12); add('pop', 21.7, 0.9, 11)
sfx.sort(key=lambda s: float(re.search(r'data-start="([\d.]+)"', s).group(1)))
out = src.replace('/*FONTS*/', fonts).replace('<!--SFX-->', '\n      '.join(sfx))
open(promo + '/videos/podrabotki-zavtra/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx')
