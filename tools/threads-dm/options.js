const DEFAULTS = {
  server: 'https://shabashka-zvkc.onrender.com',
  key: '',
  enabled: true,
  pinTab: true,
  maxAgeHours: 48,
};

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $('server').value = s.server;
  $('key').value = s.key;
  $('enabled').checked = s.enabled;
  $('pinTab').checked = s.pinTab;
  $('maxAgeHours').value = s.maxAgeHours;
}

// Ключ — 32 случайных байта латиницей: он уходит в заголовке HTTP, а там
// кириллица не проходит.
$('generate').addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  $('key').value = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 32);
});

$('save').addEventListener('click', async () => {
  const result = $('result');
  const key = $('key').value.trim();
  if (/[^\x21-\x7e]/.test(key)) {
    result.textContent = '⚠️ В ключе только латиница, цифры и знаки — без пробелов и кириллицы.';
    return;
  }
  await chrome.storage.local.set({
    server: $('server').value.trim() || DEFAULTS.server,
    key,
    enabled: $('enabled').checked,
    pinTab: $('pinTab').checked,
    maxAgeHours: Number($('maxAgeHours').value) || DEFAULTS.maxAgeHours,
  });
  result.textContent = 'Проверяю…';
  chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: '/ping' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      result.textContent = '⚠️ Фоновая часть не ответила — перезагрузите расширение.';
      return;
    }
    if (res.error) {
      result.textContent = `⚠️ ${res.error}`;
      return;
    }
    result.textContent = res.data.mbank
      ? `✅ Связь есть. Цена рекламы — ${res.data.price} сом.`
      : '✅ Связь есть, но в Render не задан MBANK_NUMBER — номер для оплаты бот не пришлёт.';
  });
});

load();
