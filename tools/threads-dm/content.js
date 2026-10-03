// Автоответчик в директе Threads — та часть, что живёт на странице.
//
// Раз в минуту фоновая часть будит вкладку-работника, и она делает обход:
//   1. отправляет то, что сервер написал сам (ссылка на пост, отчёт);
//   2. смотрит запросы на переписку — новые и изменившиеся открывает, отдаёт
//      серверу последние сообщения и отправляет его ответ, приняв запрос;
//   3. смотрит в общей папке только те разговоры, которые бот уже ведёт.
// Личную переписку владельца расширение не открывает и на сервер не шлёт.
//
// Вёрстку Threads мы не контролируем, поэтому всё, что ищется на странице,
// собрано в одном месте — dom ниже. Сломается вёрстка — чинить здесь, а
// расширение скажет об этом в логах сервера (/api/dm/log) и в своём окошке.

(() => {
  if (window.__shabashkaDm) return;
  window.__shabashkaDm = true;

  // Сколько разговоров открывать за обход: больше — и обход не уложится в
  // минуту, а людям всё равно отвечать по очереди.
  const PER_ROUND = 3;
  // Сколько последних сообщений разговора отдавать серверу.
  const LAST_MESSAGES = 15;

  const bg = (msg) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res) return reject(new Error('фоновая часть не ответила'));
        if (res.error) return reject(new Error(res.error));
        return resolve(res.data);
      });
    });
  const api = (method, path, body) => bg({ type: 'api', method, path, body });
  // Пауза через фоновую часть — см. sleep в background.js.
  const sleep = (ms) => bg({ type: 'sleep', ms });
  const human = (ms) => sleep(Math.round(ms * (0.7 + Math.random() * 0.6)));

  // Одна и та же жалоба — не чаще раза в полчаса.
  const complained = new Map();
  function complain(message) {
    const last = complained.get(message) || 0;
    if (Date.now() - last < 30 * 60 * 1000) return;
    complained.set(message, Date.now());
    console.warn('[Шабашка директ]', message);
    bg({ type: 'log', level: 'error', message }).catch(() => {});
  }

  const store = {
    async get(key, fallback) {
      const got = await chrome.storage.local.get({ [key]: fallback });
      return got[key];
    },
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
  };

  // FNV-1a — короткий устойчивый ключ сообщения.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // «27 минут назад», «13 ч. назад», «2 дня назад», «неделю назад» → часы.
  function ageHours(label) {
    const t = String(label || '').toLowerCase();
    if (!t) return null;
    if (/только что|сейчас|just now/.test(t)) return 0;
    const n = parseInt((t.match(/\d+/) || ['1'])[0], 10);
    if (/мин|min/.test(t)) return n / 60;
    if (/час|ч\.|hour|\dh/.test(t)) return n;
    if (/дн|день|day|\dd/.test(t)) return n * 24;
    if (/нед|week|\dw/.test(t)) return n * 168;
    return 9999;
  }

  const dom = {
    grid: () => document.querySelector('[role="grid"]'),
    textbox: () => document.querySelector('[role="textbox"][contenteditable="true"]'),

    // Строки списка разговоров слева: и в общей папке, и в запросах.
    listRows() {
      return [...document.querySelectorAll('a[href^="/messages/t/"]')]
        .map((a) => {
          const href = a.getAttribute('href');
          const id = (href.match(/\/messages\/t\/([^/?]+)/) || [])[1];
          const spans = [...a.querySelectorAll('span[dir="auto"]')];
          const abbr = a.querySelector('abbr[aria-label]');
          return {
            a,
            id,
            path: `/messages/t/${id}/`,
            request: /inbox_override=requests/.test(href),
            title: (spans[0] && spans[0].innerText.trim()) || '',
            preview: (spans[1] && spans[1].innerText.trim()) || '',
            age: abbr ? ageHours(abbr.getAttribute('aria-label')) : null,
          };
        })
        .filter((row) => row.id);
    },

    // Имя собеседника — ссылка на его профиль в шапке переписки, над сеткой
    // сообщений (слева в навигации — ссылка на свой профиль, её пропускаем).
    peer() {
      const grid = dom.grid();
      if (!grid) return '';
      const g = grid.getBoundingClientRect();
      const link = [...document.querySelectorAll('a[href^="/@"]')].find((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.top < g.top && r.left >= g.left - 40;
      });
      if (!link) return '';
      return decodeURIComponent(link.getAttribute('href').slice(2)).replace(/\/.*$/, '').toLowerCase();
    },

    // Сообщения переписки. У каждого сообщения своя строка с кнопками действий
    // (role=gridcell); свои сообщения прижаты вправо, чужие — влево. Дата
    // посередине — не сообщение.
    messages() {
      const grid = dom.grid();
      if (!grid || !grid.firstElementChild) return null;
      const g = grid.getBoundingClientRect();
      const rows = [...grid.firstElementChild.children].filter((row) => row.querySelector('[role="gridcell"]'));
      const seen = new Map();
      const out = [];
      for (const row of rows) {
        const leaves = [...row.querySelectorAll('[dir="auto"]')].filter(
          (e) => e.innerText.trim() && !e.querySelector('[dir="auto"]')
        );
        const parts = leaves.filter((e) => {
          const r = e.getBoundingClientRect();
          const centered =
            r.left - g.left > g.width * 0.25 && g.right - r.right > g.width * 0.25;
          return r.width > 0 && !centered;
        });
        // Аватар собеседника — 32 точки; всё крупнее — картинка в сообщении.
        const images = [...row.querySelectorAll('img')].filter((im) => im.getBoundingClientRect().width >= 60);
        if (!parts.length && !images.length) continue;
        const boxes = [...parts, ...images].map((e) => e.getBoundingClientRect());
        const right = Math.max(...boxes.map((b) => b.right)) - g.left;
        const from = right > g.width * 0.85 ? 'me' : 'them';
        const text = parts.map((e) => e.innerText.trim()).join('\n');
        const urls = images.map((im) => im.currentSrc || im.src).filter(Boolean);
        const paths = urls.map((u) => {
          try {
            return new URL(u).pathname;
          } catch {
            return u;
          }
        });
        const base = `${from}|${text}|${paths.join(',')}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        out.push({ key: `${hash(base)}-${n}`, from, text, urls });
      }
      return out;
    },

    button(names) {
      return [...document.querySelectorAll('[role="button"], button')].find((b) => {
        const label = (b.getAttribute('aria-label') || b.innerText || '').trim();
        return names.includes(label) && b.getBoundingClientRect().width > 0;
      });
    },
  };

  // Ждём, пока на странице появится нужное. Проверяем на каждое изменение
  // вёрстки и заодно раз в полсекунды — через фоновую часть, не таймером.
  async function waitFor(check, timeout = 10000) {
    const started = Date.now();
    let result = check();
    while (!result && Date.now() - started < timeout) {
      await sleep(400);
      result = check();
    }
    return result;
  }

  async function go(path) {
    const want = path.replace(/\/$/, '');
    if (location.pathname.replace(/\/$/, '') === want) return true;
    // Только точное совпадение: querySelector со списком селекторов вернёт
    // первую подходящую ссылку в документе, и «начинается с /messages/»
    // поймало бы чужую переписку.
    const link = document.querySelector(`a[href="${want}"], a[href="${want}/"]`);
    if (link) link.click();
    else {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }
    const ok = await waitFor(() => location.pathname.replace(/\/$/, '') === want, 8000);
    await human(1500);
    return Boolean(ok);
  }

  // Переписка открыта, и на странице именно она. Threads подгружает её не
  // сразу: адрес уже новый, а в шапке и в сетке ещё прошлый собеседник — и
  // ответ ушёл бы не тому человеку. Поэтому ждём, пока в шапке не окажется
  // тот, кого ждём (или хотя бы не прежний).
  async function openAt(path, expected, click) {
    const before = dom.peer();
    const here = location.pathname.replace(/\/$/, '') === path.replace(/\/$/, '');
    if (!here) {
      if (click) click();
      else await go(path);
      await waitFor(() => location.pathname.replace(/\/$/, '') === path.replace(/\/$/, ''), 8000);
    }
    const peer = await waitFor(() => {
      const now = dom.peer();
      if (!now || !dom.grid() || !dom.messages()) return '';
      if (expected) return now === expected ? now : '';
      return here || now !== before ? now : '';
    }, 12000);
    await human(1200);
    return peer || '';
  }

  // В списке слева — имя пользователя; если в нём нет пробелов, это и есть
  // ник, и шапка переписки должна показать ровно его.
  const handleOf = (title) => (/^[\w.]+$/.test(title) ? title.toLowerCase() : '');

  // Текст — в редактор Lexical. Сначала как печать с клавиатуры, не вышло —
  // как вставка из буфера.
  function typeInto(box, text) {
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, text);
    if (box.innerText.trim()) return;
    const data = new DataTransfer();
    data.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }

  async function send(text) {
    const box = await waitFor(() => dom.textbox(), 8000);
    if (!box) throw new Error('не нашёл поле ввода сообщения');
    const before = (dom.messages() || []).filter((m) => m.from === 'me').length;
    typeInto(box, text);
    await human(700);
    if (!box.innerText.trim()) throw new Error('текст не вставился в поле ввода');
    const button = dom.button(['Отправить', 'Send']);
    if (button) button.click();
    else {
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
    const sent = await waitFor(() => (dom.messages() || []).filter((m) => m.from === 'me').length > before, 10000);
    if (!sent) throw new Error('сообщение не ушло: в переписке его нет');
    await human(1500);
  }

  // Запрос на переписку надо принять — до этого поля ввода нет.
  async function accept() {
    if (dom.textbox()) return true;
    const button = dom.button(['Принять', 'Accept']);
    if (!button) return false;
    button.click();
    await human(1200);
    const confirm = document.querySelector('[role="dialog"]');
    if (confirm) {
      const yes = [...confirm.querySelectorAll('[role="button"], button')].find((b) =>
        ['Принять', 'Accept', 'Разрешить', 'Allow'].includes((b.innerText || '').trim())
      );
      if (yes) yes.click();
    }
    return Boolean(await waitFor(() => dom.textbox(), 10000));
  }

  // Картинки только у новых для сервера сообщений и не больше двух за раз:
  // ради старого чека качать мегабайты незачем.
  async function withImages(messages, known) {
    let budget = 2;
    const out = [];
    for (const m of messages) {
      const item = { key: m.key, from: m.from, text: m.text, hasImage: m.urls.length > 0 };
      if (m.from === 'them' && m.urls.length && !known.has(m.key) && budget > 0) {
        try {
          item.image = await bg({ type: 'image', url: m.urls[0] });
          budget -= 1;
        } catch (err) {
          complain(`картинку из директа не скачать: ${err.message}`);
        }
      }
      out.push(item);
    }
    return out;
  }

  // Один разговор: отдать серверу, отправить его ответ.
  async function handleThread(row) {
    const peer = await openAt(row.path, handleOf(row.title), () => row.a.click());
    if (!peer) {
      complain('переписка не открылась или не понять, с кем она: нет ссылки на профиль в шапке');
      return false;
    }
    const all = dom.messages() || [];
    const last = all.slice(-LAST_MESSAGES);
    const knownKeys = await store.get(`keys:${row.id}`, []);
    const known = new Set(knownKeys);
    const messages = await withImages(last, known);

    const { replies = [] } = await api('POST', '/threads/sync', {
      peer,
      name: row.title,
      request: row.request,
      messages,
    });
    await store.set(`keys:${row.id}`, [...knownKeys, ...last.map((m) => m.key).filter((k) => !known.has(k))].slice(-200));

    const peers = await store.get('peers', {});
    if (replies.length || peers[peer]) {
      peers[peer] = row.path;
      await store.set('peers', peers);
    }
    if (!replies.length) return true;

    // Ответ сервера уже записан у него в историю. Не ушёл отсюда — отдаём его
    // обратно в очередь исходящих, иначе человек его так и не получит.
    const giveBack = async (rest, why) => {
      complain(`ответ @${peer} не ушёл: ${why} — повторю следующим обходом`);
      await api('POST', '/threads/requeue', { peer, texts: rest }).catch(() => {});
    };
    if (row.request && !(await accept())) {
      await giveBack(replies, 'не смог принять запрос на переписку (нет кнопки «Принять» или поля ввода после неё)');
      return true;
    }
    for (let i = 0; i < replies.length; i += 1) {
      if (dom.peer() !== peer) {
        await giveBack(replies.slice(i), 'на странице открылась другая переписка');
        return true;
      }
      try {
        await human(2500);
        await send(replies[i]);
      } catch (err) {
        await giveBack(replies.slice(i), err.message);
        return true;
      }
    }
    return true;
  }

  async function sigs() {
    return store.get('sigs', {});
  }

  // Запросы на переписку: незнакомые люди. Новые и изменившиеся — в работу.
  async function roundRequests(settings) {
    if (!(await go('/messages/requests'))) return;
    await waitFor(() => dom.listRows().length, 6000);
    const known = await sigs();
    const rows = dom.listRows().filter((row) => row.request);
    let opened = 0;
    for (const row of rows) {
      if (opened >= PER_ROUND) break;
      if (known[row.id] === row.preview) continue;
      // Старые запросы при первом знакомстве не трогаем: неделю назад человек
      // уже нашёл, где разместиться, и ответ сейчас был бы странным.
      if (known[row.id] === undefined && row.age !== null && row.age > settings.maxAgeHours) {
        known[row.id] = row.preview;
        continue;
      }
      opened += 1;
      try {
        if (await handleThread(row)) known[row.id] = row.preview;
      } catch (err) {
        complain(`запрос на переписку не обработан: ${err.message}`);
      }
      await store.set('sigs', known);
      // Список после ответа перестраивается (запрос уходит в общую папку).
      await go('/messages/requests');
    }
    await store.set('sigs', known);
  }

  // Общая папка: только разговоры, которые бот уже ведёт.
  async function roundInbox() {
    const serverPeers = new Set(((await api('GET', '/peers')) || {}).peers || []);
    const localPeers = await store.get('peers', {});
    if (!serverPeers.size && !Object.keys(localPeers).length) return;
    if (!(await go('/messages/'))) return;
    await waitFor(() => dom.listRows().length, 6000);
    const known = await sigs();
    const ours = dom.listRows().filter((row) => {
      const name = row.title.toLowerCase();
      return !row.request && (serverPeers.has(name) || localPeers[name] === row.path);
    });
    let opened = 0;
    for (const row of ours) {
      if (opened >= PER_ROUND) break;
      if (known[row.id] === row.preview) continue;
      opened += 1;
      try {
        if (await handleThread(row)) known[row.id] = row.preview;
      } catch (err) {
        complain(`разговор не обработан: ${err.message}`);
      }
      await store.set('sigs', known);
    }
  }

  // То, что сервер написал сам.
  async function roundOutbox() {
    const { messages = [] } = (await api('GET', '/outbox')) || {};
    if (!messages.length) return;
    const peers = await store.get('peers', {});
    for (const item of messages) {
      const path = peers[item.peer];
      if (!path) {
        complain(`не знаю, где переписка с @${item.peer} — сообщение подождёт`);
        continue;
      }
      try {
        const peer = await openAt(path, item.peer, null);
        if (peer !== item.peer) throw new Error('переписка не открылась');
        await send(item.text);
        await api('POST', `/outbox/${item.id}/sent`, {});
      } catch (err) {
        complain(`сообщение для @${item.peer} не ушло: ${err.message}`);
      }
    }
  }

  let busy = false;

  async function round() {
    if (busy) return;
    const settings = await bg({ type: 'settings' });
    if (!settings.enabled || !settings.key) return;
    if (!(await bg({ type: 'whoami' }))) return;
    busy = true;
    const status = { ok: true, note: '' };
    try {
      await roundOutbox();
      await roundRequests(settings);
      await roundInbox();
      status.note = 'обход прошёл';
    } catch (err) {
      status.ok = false;
      status.note = err.message;
      complain(`обход сорвался: ${err.message}`);
    } finally {
      busy = false;
      bg({ type: 'status', status }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tick') round();
  });

  // Первый обход — вскоре после загрузки, не дожидаясь будильника.
  sleep(8000).then(round).catch(() => {});
})();
