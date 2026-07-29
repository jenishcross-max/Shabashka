const { execFile } = require('child_process');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const card = require('./card');

// Бинарник ffmpeg приходит npm-пакетом под текущую платформу — на Render его
// нет в системе, а ставить через apt в бесплатном плане некуда.
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const LISTING_SECONDS = 6;
const OUTRO_SECONDS = 3;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${String(stderr).split('\n').slice(-4).join(' ').trim()}`));
      else resolve();
    });
  });
}

// Ролик статичный: два кадра-картинки встык. Анимации тут не нужны — объявление
// читают, а не смотрят, и любое движение только мешает успеть прочитать текст.
//
// Возвращает Buffer с mp4. Файлы кладём во временную папку и убираем за собой:
// на Render диск эфемерный, но за время жизни процесса мусор бы копился.
async function build(parsed, listingType) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shabashka-reel-'));
  try {
    const listingPng = path.join(dir, 'listing.png');
    const outroPng = path.join(dir, 'outro.png');
    const out = path.join(dir, 'reel.mp4');

    await fs.writeFile(listingPng, card.renderListing(parsed, listingType));
    await fs.writeFile(outroPng, card.renderOutro());

    await run([
      '-y',
      '-loop', '1', '-t', String(LISTING_SECONDS), '-i', listingPng,
      '-loop', '1', '-t', String(OUTRO_SECONDS), '-i', outroPng,
      // Instagram отклоняет ролики без звуковой дорожки, поэтому подкладываем тишину
      '-f', 'lavfi', '-t', String(LISTING_SECONDS + OUTRO_SECONDS),
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p', '-r', '25', '-g', '50',
      '-c:a', 'aac', '-b:a', '64k', '-shortest',
      '-movflags', '+faststart',
      out,
    ]);

    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Подпись под постом. Ссылку Instagram кликабельной не делает ни в подписи, ни
// в комментариях — поэтому зовём в шапку профиля, а не даём голый URL.
function caption(parsed, listingType) {
  const isVacancy = listingType === 'vacancy';
  const lines = [`${isVacancy ? '💼 Вакансия' : '🧰 Заказ'}: ${parsed.title || ''}`.trim()];

  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (parsed.budget) lines.push(`💰 ${parsed.budget} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.description) lines.push('', parsed.description);

  lines.push('', 'Откликнуться — на Шабашка.com, ссылка в шапке профиля.');
  lines.push(
    '',
    ['#шабашка', '#работабишкек', '#жумуш', '#подработкабишкек', '#кыргызстан', isVacancy ? '#вакансиибишкек' : '#заказы'].join(' ')
  );

  return lines.join('\n');
}

function fileName() {
  return `${crypto.randomBytes(12).toString('hex')}.mp4`;
}

module.exports = { build, caption, fileName };
