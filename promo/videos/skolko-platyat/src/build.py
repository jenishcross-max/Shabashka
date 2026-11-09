# Собирает videos/skolko-platyat/index.html: шрифты, логотип, звуки (библиотека HyperFrames, Pixabay).
# Музыка — tools/make_audio.py beat (src/music-full.wav), здесь обрезается под длину ролика с затуханием.
import re, wave
import numpy as np
promo = 'C:/src/programs/shabashka-kg/promo'
root = promo + '/videos/skolko-platyat'
src = open(root + '/src/skolko.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))
D = float(re.search(r'id="root"[^>]*data-duration="([\d.]+)"', src).group(1))

logo = ('<svg id="s9-logo" class="logo" viewBox="0 0 100 100"><rect x="2" y="2" width="96" height="96" rx="23" fill="#fff" />'
        '<g fill="none" stroke="#F0433E" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M30 32 V60 a10 10 0 0 0 20 0 V32" /><path d="M50 32 V60 a10 10 0 0 0 20 0 V32" /></g></svg>')

with wave.open(root + '/src/music-full.wav') as w:
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(np.float32) / 32767
x = x[:int(D * sr)]
t = np.arange(len(x)) / sr
g = np.minimum(1, t / 0.2) * np.clip((D - t) / 1.0, 0, 1)
with wave.open(root + '/assets/music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(x * g[:, None], -1, 1) * 32767).astype('<i2').tobytes())

sfx = []
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'ping': 1.32, 'chime': 2.5}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
for i in range(4):                      # столбики лестницы
    add('click-soft', 0.25 + i * 0.32, 0.4, 11 + i % 2)
for t in (2.0, 4.6, 7.2, 9.8):          # карточки: переход и цена
    add('whoosh-short', t - 0.1, 0.35, 13)
    add('ping', t + 0.35, 0.22, 14)
    add('pop', t + 1.35, 0.3, 15)
add('whoosh-short', 12.3, 0.4, 13)
add('chime', 12.65, 0.3, 16)
out = src.replace('/*FONTS*/', fonts).replace('<!--LOGO-->', logo).replace('<!--SFX-->', '\n      '.join(sfx))
open(root + '/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx', D, 's')
