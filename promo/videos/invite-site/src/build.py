# Собирает videos/invite-site/index.html: шрифты, логотип, звуки (библиотека HyperFrames, Pixabay).
# Музыка — tools/make_audio.py soft (src/music-full.wav), здесь обрезается под длину ролика с затуханием.
import re, wave
import numpy as np
promo = 'C:/src/programs/shabashka-kg/promo'
root = promo + '/videos/invite-site'
src = open(root + '/src/invite.html', encoding='utf-8').read()
tpl = open(promo + '/studio/template/index.html', encoding='utf-8').read()
fonts = '\n'.join(l for l in tpl.splitlines() if l.startswith('@font-face'))
D = float(re.search(r'id="root"[^>]*data-duration="([\d.]+)"', src).group(1))


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
DUR = {'whoosh-short': 0.57, 'pop': 0.72, 'click-soft': 0.37, 'sparkle': 1.8, 'chime': 2.5}
def add(kind, t, vol, track):
    sfx.append(f'<audio id="sfx-{len(sfx)+1}" src="assets/sfx/{kind}.mp3" data-start="{t:.2f}" data-duration="{DUR[kind]}" data-volume="{vol}" data-track-index="{track}"></audio>')
add('sparkle', 0.2, 0.3, 11)            # вышивка имён
add('pop', 0.9, 0.3, 12)
add('whoosh-short', 2.95, 0.35, 13)     # подписи меняются
add('whoosh-short', 5.95, 0.35, 13)
add('whoosh-short', 8.95, 0.4, 13)      # финал
add('pop', 10.0, 0.4, 12)
add('chime', 10.4, 0.3, 14)
out = src.replace('/*FONTS*/', fonts).replace('<!--SFX-->', '\n      '.join(sfx))
open(root + '/index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('ok', len(sfx), 'sfx', D, 's')
