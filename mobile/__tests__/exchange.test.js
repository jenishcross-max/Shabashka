import { plural, relativeDate } from '../src/format';
import { taskBudget, trustLine, offersLine, OFFER_STATE_LABELS } from '../src/exchange';

describe('подписи биржи', () => {
  test('plural склоняет по трём формам', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'отклик', 'отклика', 'откликов'))).toEqual([
      'отклик',
      'отклика',
      'откликов',
      'откликов',
      'отклик',
      'отклика',
    ]);
  });

  test('бюджет: «до N сом» или цену предложат исполнители', () => {
    expect(taskBudget({ budget: 5000 })).toMatch(/^до 5\s000 сом$/);
    expect(taskBudget({ budget: null })).toBe('Цену предложат исполнители');
  });

  test('число откликов на карточке', () => {
    expect(offersLine(0)).toBe('Пока без откликов');
    expect(offersLine(3)).toBe('3 отклика');
  });

  test('trustLine: новичок и опытный', () => {
    expect(trustLine({ done_count: 0, user_since: '2026-03-10T00:00:00Z' })).toBe(
      'Новичок на бирже · на сайте с марта 2026'
    );
    expect(trustLine({ done_count: 5, user_since: '2026-03-10T00:00:00Z' })).toBe(
      '5 задач выполнено на бирже · на сайте с марта 2026'
    );
  });

  test('relativeDate: сегодня, вчера, N дней назад', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(relativeDate('2026-10-15T08:00:00Z', now)).toBe('сегодня');
    expect(relativeDate('2026-10-14T08:00:00Z', now)).toBe('вчера');
    expect(relativeDate('2026-10-12T08:00:00Z', now)).toBe('3 дня назад');
    expect(relativeDate('2026-10-10T08:00:00Z', now)).toBe('5 дней назад');
  });

  test('у каждого состояния отклика есть подпись', () => {
    for (const s of ['waiting', 'chosen', 'done', 'other', 'cancelled', 'withdrawn', 'dropped', 'removed']) {
      expect(OFFER_STATE_LABELS[s]).toBeTruthy();
    }
  });
});
