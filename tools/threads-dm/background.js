// Фоновая часть расширения: ходит на сервер Шабашки, качает картинки из
// директа и держит открытой вкладку, в которой работает автоответчик.
//
// Со страницы Threads на наш сервер напрямую не сходить — мешает CORS, да и
// ключ моста странице знать незачем. Поэтому страница (content.js) просит
// сюда, а отсюда запрос уходит с ключом из настроек.

const DEFAULTS = {
  server: 'https://shabashka-zvkc.onrender.com',
  key: '',
  enabled: true,
  pinTab: true,
  maxAgeHours: 48,
};

const WORK_URL = 'https://www.threads.com/messages/requests';
const API_TIMEOUT_MS = 90 * 1000;

const settings = () => chrome.storage.local.get(DEFAULTS);

async function api(method, path, body) {
  const { server, key } = await settings();
  if (!key) throw new Error('В настройках расширения не задан ключ моста');
  const res = await fetch(`${server.replace(/\/+$/, '')}/api/dm${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-bridge-key': key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `сервер ответил ${res.status}`);
  return data;
}

// base64 без FileReader: в service worker его может не быть.
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Картинку из директа ужимаем до 1600 точек по длинной стороне: модели со
// зрением этого хватает, чтобы прочитать чек, а сервер не получает лишние
// мегабайты.
async function image(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 1000) });
  if (!res.ok) throw new Error(`картинка не скачалась (${res.status})`);
  const blob = await res.blob();
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return `data:image/jpeg;base64,${toBase64(await jpeg.arrayBuffer())}`;
  } catch {
    return `data:${blob.type || 'image/jpeg'};base64,${toBase64(await blob.arrayBuffer())}`;
  }
}

// Вкладка-работник. Автоответчик ходит по директу сам — открывает запросы,
// переписки, — и делать это во вкладке, где владелец листает ленту, значило бы
// мешать ему. Поэтому у него своя закреплённая вкладка.
async function workerTab() {
  const { workerTabId } = await chrome.storage.session.get('workerTabId');
  if (workerTabId) {
    try {
      const tab = await chrome.tabs.get(workerTabId);
      if (tab && /^https:\/\/www\.threads\.(com|net)\//.test(tab.url || tab.pendingUrl || '')) return tab;
    } catch {
      // вкладку закрыли — заведём новую
    }
  }
  return null;
}

async function ensureWorkerTab() {
  const { enabled, pinTab, key } = await settings();
  if (!enabled || !key || !pinTab) return;
  if (await workerTab()) return;
  const tab = await chrome.tabs.create({ url: WORK_URL, pinned: true, active: false });
  await chrome.storage.session.set({ workerTabId: tab.id });
}

// Работает только одна вкладка: две вкладки ответили бы человеку дважды.
async function isWorker(tabId) {
  const { pinTab } = await settings();
  const tab = await workerTab();
  if (tab) return tab.id === tabId;
  if (pinTab) return false;
  await chrome.storage.session.set({ workerTabId: tabId });
  return true;
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('keep', { periodInMinutes: 1 });
  const { key } = await settings();
  if (!key) chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('keep', { periodInMinutes: 1 });
  ensureWorkerTab().catch(() => {});
});

// Раз в минуту: вкладка на месте, и ей пора сделать обход.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'keep') return;
  await ensureWorkerTab().catch(() => {});
  const tab = await workerTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'tick' }).catch(() => {});
});

const handlers = {
  api: (msg) => api(msg.method, msg.path, msg.body),
  image: (msg) => image(msg.url),
  // Пауза отсюда, а не таймером страницы: фоновую вкладку Chrome притормаживает,
  // и цепочка setTimeout в ней растягивается до минуты на каждый шаг.
  sleep: (msg) => new Promise((resolve) => setTimeout(() => resolve(true), Math.min(msg.ms || 0, 60000))),
  whoami: (_msg, sender) => isWorker(sender.tab && sender.tab.id),
  settings: () => settings(),
  status: async (msg) => {
    await chrome.storage.local.set({ status: { ...msg.status, at: Date.now() } });
    return true;
  },
  log: (msg) => api('POST', '/log', { level: msg.level, message: msg.message }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((data) => sendResponse({ data }))
    .catch((err) => sendResponse({ error: err.message || String(err) }));
  return true;
});
