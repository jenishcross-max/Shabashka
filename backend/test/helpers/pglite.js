// Настоящий Postgres в памяти процесса (PGlite, WASM-сборка) — для тестов, которым
// мало заглушки: атомарный выбор исполнителя и ON CONFLICT проверяются только на
// живом SQL. С боевой базой не связан ничем: данные живут, пока идёт тест.
// Заодно каждый такой тест прогоняет schema.sql целиком — ошибка в нём уронила бы
// db.init() при деплое, то есть весь сайт.
const fs = require('fs');
const path = require('path');

const SCHEMA = path.resolve(__dirname, '..', '..', 'src', 'db', 'schema.sql');

// Тот же интерфейс, что у src/db: query(text, params) → { rows }. Подменять модуль
// надо синхронно, до первого require, а PGlite поднимается асинхронно — поэтому
// каждый запрос сначала дожидается готовой базы.
function memoryDb() {
  const ready = (async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite();
    await pg.exec(fs.readFileSync(SCHEMA, 'utf8'));
    return pg;
  })();
  return {
    ready,
    query: async (text, params) => (await ready).query(text, params),
  };
}

module.exports = { memoryDb };
