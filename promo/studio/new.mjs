// Новый ролик из заготовки за одну команду:
//
//   node studio/new.mjs <имя-латиницей> [beat|soft|calm]
//
// Копирует studio/template в videos/<имя>, проставляет имя проекта и генерирует
// свою музыку и звуки (tools/make_audio.py) ровно под длину ролика — её берём из
// data-duration корня в index.html. Без python и numpy ролик всё равно
// создаётся, а команду для звука скрипт напечатает.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const promo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(promo, 'studio', 'template');
const MOODS = ['beat', 'soft', 'calm'];

const [name, mood = 'beat'] = process.argv.slice(2);

if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('Имя ролика — латиницей через дефис, например: node studio/new.mjs pov-chat');
  process.exit(1);
}
if (!MOODS.includes(mood)) {
  console.error(`Настроение музыки — одно из: ${MOODS.join(', ')}`);
  process.exit(1);
}

const target = path.join(promo, 'videos', name);
if (existsSync(target)) {
  console.error(`Ролик videos/${name} уже есть — выберите другое имя.`);
  process.exit(1);
}

cpSync(template, target, { recursive: true });

for (const file of ['package.json', 'meta.json']) {
  const p = path.join(target, file);
  const text = readFileSync(p, 'utf8')
    .replaceAll('__NAME__', name)
    .replaceAll('__CREATED__', new Date().toISOString());
  writeFileSync(p, text);
}

const html = readFileSync(path.join(target, 'index.html'), 'utf8');
const duration = Number((html.match(/id="root"[^>]*data-duration="([\d.]+)"/) || [])[1] || 15);
// Музыка с запасом в секунду: короче ролика её быть не должно.
const seconds = String(Math.ceil(duration) + 1);

const script = path.join(promo, 'tools', 'make_audio.py');
const assets = path.join(target, 'assets');
// На Windows python3 — заглушка Microsoft Store, поэтому сначала python и py.
const pythons = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
const made = pythons.some((py) => {
  const r = spawnSync(py, [script, assets, seconds, mood], { stdio: 'ignore' });
  return r.status === 0;
});

console.log(`Готово: videos/${name}`);
if (!made) {
  console.log('Звук не собрался (нужны python и numpy). Соберите его так:');
  console.log(`  python tools/make_audio.py videos/${name}/assets ${seconds} ${mood}`);
}
console.log('Дальше:');
console.log(`  cd videos/${name}`);
console.log('  npm run dev       # редактор в браузере');
console.log(`  npx --yes hyperframes@0.8.169 render --quality delivery --output renders/${name}.mp4`);
