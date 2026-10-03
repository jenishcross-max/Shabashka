const $ = (id) => document.getElementById(id);

function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

async function load() {
  const { enabled = true, key = '', status = null } = await chrome.storage.local.get(['enabled', 'key', 'status']);
  $('enabled').checked = enabled;
  if (!key) $('status').textContent = 'Не задан ключ моста — откройте настройки.';
  else if (!status) $('status').textContent = 'Обходов ещё не было. Во вкладке Threads должен быть открыт директ.';
  else $('status').textContent = `${status.ok ? '✅' : '⚠️'} Последний обход ${ago(status.at)}: ${status.note}`;
}

$('enabled').addEventListener('change', () => chrome.storage.local.set({ enabled: $('enabled').checked }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
