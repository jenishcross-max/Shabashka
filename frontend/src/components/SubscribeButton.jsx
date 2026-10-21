import { api } from '../api';
import { landingForCategory } from '../landings';

// Подписка на новые вакансии в Telegram-боте (см. backend/src/telegram/subscriptions.js).
// Человек пришёл с поста на одну вакансию, позвонил и ушёл — без подписки повода
// вернуться у него нет (замер 21 октября 2026, см.
// docs/plans/2026-10-21-subscribe-and-sources.md). У категории со страницей
// профессии — подписка сразу на неё, иначе — меню бота со всеми профессиями.
// Бот присылает только вакансии, поэтому у заказов кнопки нет.
export default function SubscribeButton({ category, className = '' }) {
  const landing = category ? landingForCategory(category) : null;
  return (
    <a
      className={`landing-subscribe${className ? ` ${className}` : ''}`}
      href={api.subscribeUrl(landing?.slug)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {landing ? `🔔 Новые вакансии «${landing.short}» в Telegram` : '🔔 Новые вакансии в Telegram'}
    </a>
  );
}
