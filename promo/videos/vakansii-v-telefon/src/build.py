# Собирает videos/vakansii-v-telefon/index.html: шрифты, логотип, звуки (библиотека HyperFrames,
# Pixabay). Музыка — tools/make_audio.py beat, здесь обрезается до 10 с с затуханием.
import re, wave
import numpy as np
promo = 'C:/src/programs/shabashka-kg/promo'
root = promo + '/videos/vakansii-v-telefon'
src = open(root + '/src/vakansii.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))

logo = ('<svg viewBox="0 0 100 100"><rect x="2" y="2" width="96" height="96" rx="23" fill="#F0433E" />'
        '<g fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M30 32 V60 a10 10 0 0 0 20 0 V32" /><path d="M50 32 V60 a10 10 0 0 0 20 0 V32" /></g></svg>')

# Музыка: из src/music-full.wav (make_audio beat, 14 с) — 10 с, мягкий вход и затухание последней секунды
D = 10.0
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
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'chime': 2.5, 'notification': 2.46}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('notification', 0.05, 0.35, 11)
add('pop', 0.85, 0.35, 12)
add('pop', 1.6, 0.35, 13)
add('whoosh-short', 3.7, 0.4, 14)
add('pop', 4.15, 0.35, 12)
add('pop', 4.85, 0.35, 13)
add('click-soft', 5.6, 0.5, 15)
add('chime', 6.1, 0.3, 11)
out = src.replace('/*FONTS*/', fonts).replace('<!--LOGO-->', logo).replace('<!--SFX-->', '\n      '.join(sfx))
open(root + '/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx')
