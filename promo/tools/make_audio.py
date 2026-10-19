"""Своя музыка и звуки для промо-роликов: без чужих прав и без сети.

python3 make_audio.py <папка> <длина_музыки_сек> [настроение]
Пишет music.wav, pop.wav и whoosh.wav. Настроение: beat (по умолчанию — бит
120 BPM, как в первых роликах), soft (колокольчики 96 BPM — для пригласительных),
calm (спокойно, 84 BPM — для читалки).
"""
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)  # сид: одинаковый звук при каждой сборке


def write(path, x):
    x = np.clip(x, -1, 1)
    stereo = np.stack([x, x], axis=1) if x.ndim == 1 else x
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.12)


def hat():
    n = int(0.06 * SR)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(4) / 4, "same")  # грубый ВЧ-фильтр
    return noise * env(n, 0.001, 0.015) * 0.35


def clap():
    n = int(0.2 * SR)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(8) / 8, "same")
    e = env(n, 0.001, 0.06)
    for d in (0.01, 0.02):  # «хлопок» из трёх коротких щелчков
        k = int(d * SR)
        e[k:] += env(n - k, 0.001, 0.05)[: n - k] * 0.6
    return noise * e * 0.45


def tone(freq, dur, kind="saw", attack=0.01, decay=0.3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "saw":
        x = sum(np.sin(2 * np.pi * freq * h * t) / h for h in range(1, 8))
    else:
        x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)
    return x * env(n, attack, decay)


def place(buf, clip, at):
    i = int(at * SR)
    j = min(len(buf), i + len(clip))
    if i < len(buf):
        buf[i:j] += clip[: j - i]


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


def music(length):
    n = int(length * SR)
    drums = np.zeros(n)
    bass = np.zeros(n)
    keys = np.zeros(n)
    beat = 0.5  # 120 BPM
    # Am – F – C – G: бодро и без пафоса
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]
    roots = [45, 41, 36, 43]
    bars = int(length / (4 * beat)) + 1
    for bar in range(bars):
        t0 = bar * 4 * beat
        ci = bar % 4
        for b in range(4):
            tb = t0 + b * beat
            place(drums, kick(), tb)
            place(drums, hat(), tb + beat / 2)
            if b in (1, 3):
                place(drums, clap(), tb)
            for e in range(2):  # бас восьмыми
                place(bass, tone(midi(roots[ci]), 0.22, "sine", 0.005, 0.12) * 0.55, tb + e * beat / 2)
        for k, b in enumerate((0, 1.5, 2.5, 3)):  # синкопа аккордом
            for m in chords[ci]:
                place(keys, tone(midi(m + 12), 0.3, "saw", 0.005, 0.15) * 0.07, t0 + b * beat)
    # первые два такта без бочки — вступление, дальше полный бит
    intro = int(4 * beat * SR)
    drums[:intro] *= np.linspace(0.3, 1, intro)
    mix = drums * 0.7 + bass * 0.6 + keys
    fade = int(1.5 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix / np.max(np.abs(mix)) * 0.8


def bell(freq, dur):
    """Колокольчик: синус с призвуками и долгим затуханием."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) + 0.12 * np.sin(2 * np.pi * freq * 3.02 * t)
    return x * env(n, 0.003, dur / 3)


def gentle(length, bpm, chords, roots, arp_octave, drums_level):
    """Мягкая музыка: пэд из аккордов, арпеджио колокольчиками и тихий бит."""
    n = int(length * SR)
    pad = np.zeros(n)
    arp = np.zeros(n)
    drums = np.zeros(n)
    bass = np.zeros(n)
    beat = 60 / bpm
    bars = int(length / (4 * beat)) + 1
    for bar in range(bars):
        t0 = bar * 4 * beat
        ci = bar % len(chords)
        for m in chords[ci]:
            place(pad, tone(midi(m), 4 * beat, "sine", 0.4, 2.5) * 0.06, t0)
        place(bass, tone(midi(roots[ci]), 2 * beat, "sine", 0.02, 0.8) * 0.35, t0)
        place(bass, tone(midi(roots[ci]), 2 * beat, "sine", 0.02, 0.8) * 0.25, t0 + 2 * beat)
        notes = list(chords[ci]) + [chords[ci][1] + 12]
        for e in range(8):  # арпеджио восьмыми
            m = notes[e % len(notes)] + arp_octave
            place(arp, bell(midi(m), 1.2) * (0.09 if e % 2 == 0 else 0.06), t0 + e * beat / 2)
        if bar >= 1:  # бит со второго такта
            for b in range(4):
                tb = t0 + b * beat
                if b in (0, 2):
                    place(drums, kick() * 0.6, tb)
                place(drums, hat() * 0.5, tb + beat / 2)
                if b == 3:
                    place(drums, clap() * 0.4, tb)
    mix = pad + arp + bass + drums * drums_level
    fade = int(1.5 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix / np.max(np.abs(mix)) * 0.8


MOODS = {
    "beat": music,
    # До мажор: C – G – Am – F — светло, по-праздничному.
    "soft": lambda length: gentle(
        length, 96, [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)], [48, 43, 45, 41], 12, 0.45
    ),
    # Am – F – C – G тише и медленнее: фон для чтения.
    "calm": lambda length: gentle(
        length, 84, [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)], [45, 41, 36, 43], 12, 0.6
    ),
}


def pop():
    n = int(0.15 * SR)
    t = np.arange(n) / SR
    f = 500 + 900 * np.exp(-t * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.035) * 0.7


def whoosh():
    n = int(0.45 * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for i in range(0, n, 512):  # фильтр, который «открывается» и закрывается
        width = int(2 + 30 * (1 - np.sin(np.pi * i / n)))
        seg = noise[i : i + 512]
        out[i : i + 512] = np.convolve(seg, np.ones(width) / width, "same")
    shape = np.sin(np.pi * np.arange(n) / n) ** 2
    return out * shape / np.max(np.abs(out * shape)) * 0.5


if __name__ == "__main__":
    folder, length = sys.argv[1], float(sys.argv[2])
    mood = sys.argv[3] if len(sys.argv) > 3 else "beat"
    write(f"{folder}/music.wav", MOODS[mood](length))
    write(f"{folder}/pop.wav", pop())
    write(f"{folder}/whoosh.wav", whoosh())
