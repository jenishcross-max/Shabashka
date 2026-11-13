// Отклик на бирже без аккаунта (src/guestOffer.js). У гостя нет переписки на
// сайте, поэтому заказчик пишет ему в WhatsApp — ссылка сразу с текстом про
// задачу, чтобы человек понял, откуда сообщение.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerWaLink, rememberGuestOffer, sentAsGuest } from '../src/guestOffer.js';

test('ссылка в WhatsApp: только цифры номера и текст про задачу', () => {
  const link = offerWaLink('+996 700 123-456', 'Помыть окна');
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, 'https://wa.me/996700123456');
  assert.equal(url.searchParams.get('text'), 'Здравствуйте! Вы откликнулись на мою задачу «Помыть окна» на Шабашке.');
});

test('отправленный гостем отклик помним на этом устройстве', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  assert.equal(sentAsGuest(7), false);
  rememberGuestOffer(7);
  assert.equal(sentAsGuest(7), true);
  assert.equal(sentAsGuest(8), false);
});

test('без localStorage (приватный режим) — не падаем', () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  rememberGuestOffer(7);
  assert.equal(sentAsGuest(7), false);
});
