import { api } from '../api';

// WhatsApp-канал Шабашки — рядом с подпиской в Telegram-боте. 21 ноября 2026 его
// 58 подписчиков дали 13 откликов за день — больше, чем группа в 461 человек, а на
// сайте канала не было вовсе, хотя «💬 WhatsApp» у вакансии жмут 47 раз в день:
// эти люди уже в WhatsApp и ищут работу (docs/plans/2026-11-22-whatsapp-instagram-growth.md).
// Ссылка — через бэкенд: переход виден в сводке бота («с сайта N»).
export default function ChannelButton({ className = '' }) {
  return (
    <a
      className={`landing-subscribe landing-subscribe-wa${className ? ` ${className}` : ''}`}
      href={api.channelUrl('site')}
      target="_blank"
      rel="noopener noreferrer"
    >
      💬 Все вакансии — в канале WhatsApp
    </a>
  );
}
