// Вход WhatsApp-канала (см. channel.js) — в базе, а не в папке, как в примерах
// Baileys: у бесплатного Render нет диска, и после каждого перезапуска или
// деплоя второй номер пришлось бы привязывать заново.
//
// Это тот же useMultiFileAuthState из Baileys, только «файл» — строка wa_auth:
// creds — сам вход, '<тип>-<id>' — ключи шифрования. Buffer в JSON пишется через
// BufferJSON библиотеки: обычный JSON вернул бы вместо ключа простой объект.
const db = require('../db');

const CREDS = 'creds';

async function readMany(keys, reviver) {
  if (!keys.length) return new Map();
  const { rows } = await db.query('SELECT key, value FROM wa_auth WHERE key = ANY($1::text[])', [keys]);
  return new Map(rows.map((row) => [row.key, JSON.parse(row.value, reviver)]));
}

// Одним запросом: при входе Baileys кладёт разом десятки ключей, и по запросу на
// ключ к Supabase это были бы секунды.
async function writeMany(entries, replacer) {
  if (!entries.length) return;
  await db.query(
    `INSERT INTO wa_auth (key, value, updated_at)
     SELECT key, value, NOW() FROM unnest($1::text[], $2::text[]) AS t(key, value)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [entries.map(([key]) => key), entries.map(([, value]) => JSON.stringify(value, replacer))]
  );
}

// lib — сам модуль Baileys. Он ESM и грузится через import(), поэтому его
// передают сюда, а не берут через require.
async function useDbAuthState(lib) {
  const { BufferJSON, initAuthCreds, proto } = lib;
  const creds = (await readMany([CREDS], BufferJSON.reviver)).get(CREDS) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const found = await readMany(
            ids.map((id) => `${type}-${id}`),
            BufferJSON.reviver
          );
          const out = {};
          for (const id of ids) {
            let value = found.get(`${type}-${id}`) ?? null;
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          const put = [];
          const drop = [];
          for (const type of Object.keys(data)) {
            for (const [id, value] of Object.entries(data[type])) {
              if (value) put.push([`${type}-${id}`, value]);
              else drop.push(`${type}-${id}`);
            }
          }
          await writeMany(put, BufferJSON.replacer);
          if (drop.length) await db.query('DELETE FROM wa_auth WHERE key = ANY($1::text[])', [drop]);
        },
      },
    },
    saveCreds: () => writeMany([[CREDS, creds]], BufferJSON.replacer),
  };
}

// Номер отвязали в телефоне — старый вход больше не пустят, а мешать он будет:
// с ним бот не попросит новый код.
async function clear() {
  await db.query('DELETE FROM wa_auth');
}

module.exports = { useDbAuthState, clear };
