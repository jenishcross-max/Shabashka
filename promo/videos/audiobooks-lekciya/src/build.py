# Собирает videos/audiobooks-lekciya/index.html: шрифты, волна голосового по настоящей громкости
# записи бота, звуки (библиотека HyperFrames, Pixabay). Музыки нет — её выберет владелец.
import re, wave
import numpy as np
promo = 'C:/src/programs/shabashka-kg/promo'
root = promo + '/videos/audiobooks-lekciya'
src = open(root + '/src/audiobooks.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))

# Волна: 36 столбиков по громкости assets/voice.wav, загораются, пока голос играет (7,0–12,6 с)
with wave.open(root + '/assets/voice.wav') as w:
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, w.getnchannels())[:, 0].astype(float)
N = 36
env = np.array([np.sqrt(np.mean(c ** 2)) for c in np.array_split(x, N)])
h = (18 + 72 * env / env.max()).astype(int)
bars = ''.join(f'<i id="w{i}" style="height: {v}px"></i>' for i, v in enumerate(h))
wave_js = f"for (let i = 0; i < {N}; i++) tl.set('#w' + i, {{ backgroundColor: '#3a8de0' }}, 7.0 + i * {5.59 / N:.4f});"

sfx = []
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'chime': 2.5, 'notification': 2.46}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('whoosh-short', 1.65, 0.4, 11)
add('pop', 1.9, 0.45, 12)
add('pop', 2.8, 0.35, 12)
add('notification', 5.7, 0.35, 13)
add('click-soft', 6.95, 0.5, 14)
add('pop', 9.6, 0.4, 12)
add('whoosh-short', 12.55, 0.4, 11)
add('chime', 13.35, 0.4, 13)
sfx.sort(key=lambda s: float(re.search(r'data-start="([\d.]+)"', s).group(1)))
out = (src.replace('/*FONTS*/', fonts).replace('<!--SFX-->', '\n      '.join(sfx))
       .replace('<!--WAVE-->', bars).replace('/*WAVE_JS*/', wave_js))
open(root + '/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx')
