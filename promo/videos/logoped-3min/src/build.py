# Собирает videos/logoped-3min/index.html: шрифты из заготовки + звуки (библиотека HyperFrames, Pixabay).
# Музыки нет — её выберет владелец.
import re
promo = 'C:/src/programs/shabashka-kg/promo'
src = open(promo + '/videos/logoped-3min/src/logoped.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))
sfx = []
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'chime': 2.5}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('pop', 0.5, 0.45, 11)
add('whoosh-short', 1.75, 0.4, 12)
for t in (1.85, 3.85, 5.85, 7.85, 9.85):
    add('click-soft', t, 0.45, 13)
add('whoosh-short', 13.15, 0.4, 12)
add('chime', 14.3, 0.4, 14)
sfx.sort(key=lambda s: float(re.search(r'data-start="([\d.]+)"', s).group(1)))
out = src.replace('/*FONTS*/', fonts).replace('<!--SFX-->', '\n      '.join(sfx))
open(promo + '/videos/logoped-3min/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx')
