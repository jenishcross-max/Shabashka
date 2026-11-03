# Мем-ролик из чужого клипа за одну команду:
#
#   python tools/meme.py <имя> <клип.mp4> --from 0 --to 4.2 \
#       --caption "Работодатель читает моё резюме:" \
#       --sub "0:Физика два, химия два" --sub "2.1:литература два, история два" \
#       --end "Работа без резюме — шабашка.com" [--key]
#
# Делает videos/<имя> из заготовки (если его ещё нет): подпись-мем сверху,
# клип с его же звуком, субтитры, в конце 2,2 с финал с адресом. --key —
# клип на зелёном фоне: фон вырезаем, человека ставим на фирменный тёмный.
# Горизонтальный клип ложится по центру поверх своей же размытой копии.
# После сборки: cd videos/<имя> && npm run check.
import argparse
import html
import json
import pathlib
import subprocess
import sys

import numpy as np

promo = pathlib.Path(__file__).resolve().parent.parent
W, H, FPS = 1080, 1920, 30
END = 2.2  # финал с адресом
CLIP_TOP = 560  # выше — подпись-мем, клип с ключом ставим ниже неё

ap = argparse.ArgumentParser()
ap.add_argument('name')
ap.add_argument('clip')
ap.add_argument('--from', dest='start', type=float, default=0)
ap.add_argument('--to', dest='stop', type=float, required=True)
ap.add_argument('--caption', required=True)
ap.add_argument('--sub', action='append', default=[], help='«секунда:текст», показывается до следующего')
ap.add_argument('--end', default='Работа и подработка — шабашка.com')
ap.add_argument('--key', action='store_true', help='клип на зелёном фоне')
ap.add_argument('--subs-y', type=int, default=1440, help='высота субтитров, px от верха')
ap.add_argument('--bottom', action='store_true', help='прижать фигуру к низу кадра')
ap.add_argument('--green', default='auto', help='цвет зелёного фона, 0xRRGGBB; auto — по углу кадра')
args = ap.parse_args()

target = promo / 'videos' / args.name
assets = target / 'assets'
if not target.exists():
    subprocess.run(['node', str(promo / 'studio' / 'new.mjs'), args.name, 'beat'], check=True, capture_output=True)
(assets / 'clips').mkdir(parents=True, exist_ok=True)

clip_dur = round(args.stop - args.start, 2)
total = round(clip_dur + END, 2)


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    s = json.loads(out)['streams'][0]
    return s['width'], s['height']


def green_bbox(path, w, h):
    """Где в кадре не зелёный фон — по кадрам выбранного куска."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(args.start), '-t', str(clip_dur), '-i', path,
                          '-vf', 'fps=4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(int)
    r, g, b = frames[..., 0], frames[..., 1], frames[..., 2]
    person = ~((g > 150) & (g > r + 60) & (g > b + 60))
    mask = person.any(axis=0)
    # Берём самую «плотную» полосу строк: мелкие надписи на фоне (водяной знак
    # снизу) отделены от фигуры пустыми строками и в рамку не попадают.
    filled = mask.sum(axis=1)
    rows = np.where(filled > max(3, w * 0.002))[0]
    bands, start = [], rows[0]
    for prev, cur in zip(rows, rows[1:]):
        if cur - prev > 15:
            bands.append((start, prev))
            start = cur
    bands.append((start, rows[-1]))
    y0, y1 = max(bands, key=lambda b: filled[b[0]:b[1] + 1].sum())
    y1 += 1
    xs = np.where(mask[y0:y1].any(axis=0))[0]
    x0, x1 = xs.min(), xs.max() + 1
    # Ровный срез сбоку или снизу — человек обрезан ещё в исходнике.
    rows_n, cols_n = y1 - y0, x1 - x0
    cut_left = mask[y0:y1, x0].sum() > rows_n * 0.4
    cut_right = mask[y0:y1, x1 - 1].sum() > rows_n * 0.4
    cut_bottom = mask[y1 - 1, x0:x1].sum() > cols_n * 0.3
    return x0, y0, x1, y1, cut_left, cut_right, cut_bottom


src = str(pathlib.Path(args.clip).resolve())
sw, sh = probe(src)
trim = f'trim={args.start}:{args.stop},setpts=PTS-STARTPTS,fps={FPS}'
if args.key:
    x0, y0, x1, y1, cut_left, cut_right, cut_bottom = green_bbox(src, sw, sh)
    if args.green == 'auto':
        corner = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(args.start), '-i', src, '-frames:v', '1',
                                 '-vf', 'crop=8:8:4:4,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                capture_output=True, check=True).stdout
        args.green = '0x%02X%02X%02X' % tuple(corner[:3])
    bw, bh = x1 - x0, y1 - y0
    # Человек — как можно крупнее в зоне под подписью; обрезан снизу — ставим вплотную к низу.
    print(f'фигура {bw}×{bh} в ({x0},{y0}), срезы: слева {cut_left}, справа {cut_right}, снизу {cut_bottom}')
    scale = min(W / bw, (H - CLIP_TOP) / bh)
    ow, oh = int(bw * scale) // 2 * 2, int(bh * scale) // 2 * 2
    # Срез прижимаем к краю кадра, чтобы не было видно, что человек «отрезан».
    ox = W - ow if cut_right and not cut_left else 0 if cut_left and not cut_right else (W - ow) // 2
    oy = H - oh if args.bottom or cut_bottom or y1 >= sh - 2 else CLIP_TOP + (H - CLIP_TOP - oh) // 2
    graph = (f'color=c=0x2e2321:s={W}x{H}:r={FPS},vignette=PI/4[bg];'
             f'[0:v]{trim},crop={bw}:{bh}:{x0}:{y0},chromakey={args.green}:0.13:0.06,despill=type=green,'
             f'scale={ow}:{oh}:flags=lanczos[fg];[bg][fg]overlay={ox}:{oy}:shortest=1,format=yuv420p')
elif sh >= sw:
    graph = f'[0:v]{trim},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},format=yuv420p'
else:
    fh = int(sh * W / sw) // 2 * 2
    graph = (f'[0:v]{trim},split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},'
             f'boxblur=30:2,eq=brightness=-0.12[bg];[b]scale={W}:{fh}:flags=lanczos[fg];'
             f'[bg][fg]overlay=0:{CLIP_TOP + (H - CLIP_TOP - 300 - fh) // 2},format=yuv420p')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', graph, '-t', str(clip_dur), '-an',
                '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', str(assets / 'clips' / 'clip.mp4')], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(args.start), '-t', str(clip_dur), '-i', src, '-vn',
                '-af', f'afade=t=out:st={max(clip_dur - 0.15, 0)}:d=0.15', '-ar', '48000', '-ac', '2',
                str(assets / 'clip.wav')], check=True)
subprocess.run([sys.executable, str(promo / 'tools' / 'make_audio.py'), str(assets), str(int(total) + 1), 'beat'],
               check=True, capture_output=True)

# Субтитры: каждый держится до следующего, последний — до конца клипа.
subs = []
for item in args.sub:
    t, text = item.split(':', 1)
    subs.append((float(t), text))
subs_html, subs_js = [], []
for i, (t, text) in enumerate(subs):
    t_end = subs[i + 1][0] if i + 1 < len(subs) else clip_dur
    subs_html.append(f'<div id="sub{i}" class="clip subs" data-start="{t}" data-duration="{round(t_end - t, 2)}" '
                     f'data-track-index="{3 + i % 2}">{html.escape(text)}</div>')
    subs_js.append(f"tl.fromTo('#sub{i}', {{ opacity: 0, scale: 0.6 }}, {{ opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2.4)' }}, {t + 0.02});")

tpl = (promo / 'tools' / 'meme.html').read_text(encoding='utf-8')
fonts = '\n'.join(l for l in (promo / 'studio' / 'template' / 'index.html').read_text(encoding='utf-8').splitlines()
                  if l.startswith('@font-face'))
page = (tpl.replace('/*FONTS*/', fonts)
        .replace('{{TITLE}}', html.escape(args.caption))
        .replace('{{CAPTION}}', html.escape(args.caption))
        .replace('{{END_TEXT}}', html.escape(args.end))
        .replace('{{SUBS}}', '\n      '.join(subs_html))
        .replace('/*SUBS_JS*/', '\n      '.join(subs_js))
        .replace('{{SUBS_Y}}', str(args.subs_y))
        .replace('{{TOTAL}}', str(total))
        .replace('{{CLIP}}', str(clip_dur))
        .replace('{{END_AT}}', str(clip_dur))
        .replace('{{END_DUR}}', str(END))
        .replace('{{END_POP}}', str(round(clip_dur + 0.45, 2)))
        .replace('{{END_WHOOSH}}', str(round(clip_dur - 0.15, 2)))
        .replace('/*END_AT*/', str(clip_dur)))
(target / 'index.html').write_text(page, encoding='utf-8', newline='\n')
print(f'Готово: videos/{args.name} — {total} с (клип {clip_dur} с + финал {END} с)')
