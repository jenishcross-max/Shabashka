const { spawn } = require('child_process');
const { once } = require('events');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const card = require('./card');
const music = require('./music');

// Бинарник ffmpeg приходит npm-пакетом под текущую платформу — на Render его
// нет в системе, а ставить через apt в бесплатном плане некуда.
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Кадры отдаём ffmpeg сырыми пикселями в stdin, а не пишем PNG на диск: 270
// картинок по 3,7 МБ — это лишние полтора гигабайта записи и столько же чтения
// ради данных, которые живут доли секунды.
function render(args, renderer) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

    let tail = '';
    proc.stderr.on('data', (chunk) => {
      tail = (tail + chunk).slice(-4000);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg: ${tail.split('\n').filter(Boolean).slice(-3).join(' ').trim()}`));
    });

    // Если ffmpeg упал, недописанный кадр прилетит сюда как EPIPE. Настоящую
    // причину скажет stderr и код возврата, так что здесь просто молчим.
    proc.stdin.on('error', () => {});

    (async () => {
      for (let i = 0; i < renderer.frames; i++) {
        if (proc.exitCode !== null) return;
        // Ждём drain на каждом кадре: без этого Node сложит весь ролик в свою
        // очередь записи, и памяти уйдёт больше, чем весь лимит контейнера.
        if (!proc.stdin.write(renderer.frame(i / card.FPS))) await once(proc.stdin, 'drain');
      }
      proc.stdin.end();
    })().catch(() => {});
  });
}

// Сборки идут строго по одной. Админ публикует объявления пачкой, и два
// одновременных кодирования вместе с канвасами снова упёрлись бы в 512 МБ —
// а ждать тут нечего, ролик собирается за секунды.
let chain = Promise.resolve();

function build(parsed, listingType) {
  const next = chain.then(() => encode(parsed, listingType));
  chain = next.catch(() => {}); // провал одной сборки не должен рвать очередь
  return next;
}

// Возвращает { buffer, credit } — mp4 и строку об авторе трека для подписи к
// посту. Файл кладём во временную папку и убираем за собой: на Render диск
// эфемерный, но за время жизни процесса мусор бы копился.
async function encode(parsed, listingType) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shabashka-reel-'));
  try {
    const out = path.join(dir, 'reel.mp4');
    const renderer = card.createRenderer(parsed, listingType);
    const track = music.pick();

    const args = [
      '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${card.W}x${card.H}`, '-r', String(card.FPS),
      '-i', 'pipe:0',
    ];

    if (track) {
      // Трек может быть короче ролика — зацикливаем и обрезаем по видео.
      args.push('-stream_loop', '-1', '-i', track.file);
    } else {
      // Instagram отклоняет ролики без звуковой дорожки, поэтому подкладываем тишину
      args.push('-f', 'lavfi', '-t', String(card.TOTAL_SECONDS),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    }

    args.push(
      '-map', '0:v', '-map', '1:a',
      // Один поток вместо потока на ядро. libx264 держит свой набор буферов кадров
      // на каждый поток, а на 512 МБ бесплатного Render многопоточное кодирование
      // упирается в лимит памяти, и процесс убивают (137).
      '-threads', '1',
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-r', String(card.FPS), '-g', String(card.FPS * 2),
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100', '-shortest',
      '-movflags', '+faststart'
    );

    if (track) {
      // Голоса в ролике нет, перекрывать музыке нечего — стоит она заметно
      // громче типичного фона. Треки в фонотеке уже выровнены по громкости при
      // нарезке, поэтому одного общего множителя хватает на всю папку.
      args.push('-af', `volume=0.8,afade=t=in:st=0:d=0.8,afade=t=out:st=${card.TOTAL_SECONDS - 1.2}:d=1.2`);
    }

    args.push(out);

    await render(args, renderer);
    return { buffer: await fs.readFile(out), credit: track ? track.credit : null };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Подпись под постом. Ссылку Instagram кликабельной не делает ни в подписи, ни
// в комментариях — поэтому зовём в шапку профиля, а не даём голый URL.
function caption(parsed, listingType, credit) {
  const isVacancy = listingType === 'vacancy';
  const lines = [`${isVacancy ? '💼 Вакансия' : '🧰 Заказ'}: ${parsed.title || ''}`.trim()];

  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (parsed.budget) lines.push(`💰 ${parsed.budget} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.description) lines.push('', parsed.description);

  lines.push('', 'Откликнуться — на Шабашка.com, ссылка в шапке профиля.');
  // Автора трека называем обязательно: музыка в фонотеке под Creative Commons,
  // и указание автора — условие, на котором её вообще можно использовать.
  if (credit) lines.push('', credit);
  lines.push(
    '',
    ['#шабашка', '#работабишкек', '#жумуш', '#подработкабишкек', '#кыргызстан', isVacancy ? '#вакансиибишкек' : '#заказы'].join(' ')
  );

  return lines.join('\n');
}

function fileName() {
  return `${crypto.randomBytes(12).toString('hex')}.mp4`;
}

module.exports = { build, caption, fileName, COVER_MS: Math.round(card.COVER_AT * 1000) };
