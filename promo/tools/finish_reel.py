"""Доводка ролика после рендера: громкость −14 LUFS (loudnorm в два прохода) и сжатие x264.

python tools/finish_reel.py <рендер.mp4> <готовый.mp4>

Почему так:
- бот скачивает видео продукта из Telegram целиком и только до 20 МБ (telegram/products.js):
  тяжелее — пост уходит без ролика, и Instagram его не принимает. Целимся в 15 МБ и меньше;
- один проход loudnorm с потолком −1,5 dBTP недобирает громкость (выходило −15,6),
  второй проход с замерами первого попадает в −14.
"""
import json, os, re, subprocess, sys

src, dst = sys.argv[1], sys.argv[2]
TARGET = 'I=-14:TP=-1.5:LRA=11'


def run(args):
    return subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')


probe = run(['ffmpeg', '-hide_banner', '-i', src, '-af', f'loudnorm={TARGET}:print_format=json', '-f', 'null', '-'])
m = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', probe.stderr)[-1])
second = (f"loudnorm={TARGET}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
res = run(['ffmpeg', '-hide_banner', '-y', '-i', src,
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '8M', '-bufsize', '16M',
           '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30',
           '-af', second, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', dst])
if res.returncode:
    print(res.stderr[-2000:]); sys.exit(1)

check = run(['ffmpeg', '-hide_banner', '-i', dst, '-af', 'ebur128', '-f', 'null', '-'])
lufs = re.findall(r'I:\s+(-?[\d.]+) LUFS', check.stderr)
mb = os.path.getsize(dst) / 1e6
print(f'{dst}: {mb:.1f} МБ, громкость {lufs[-1] if lufs else "?"} LUFS')
if mb > 15:
    print('ВНИМАНИЕ: больше 15 МБ — бот может не скачать (лимит Telegram 20 МБ). Поднимите -crf.')
