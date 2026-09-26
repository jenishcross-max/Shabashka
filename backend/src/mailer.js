const { RESEND_API_KEY, SMTP_FROM } = process.env;

// Письмо собирается из строк, которые пользователь вписал сам при регистрации.
// Имя вроде «<b>» или целый тег со ссылкой превратили бы письмо о подтверждении
// почты в что-то другое — а выглядело бы оно письмом от нас.
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Resend обычно отвечает за доли секунды. Срок нужен на случай, когда он не
// отвечает вовсе: письмо отправляется из обработчика регистрации, и человек всё
// это время смотрит на крутящуюся кнопку.
const TIMEOUT_MS = 20 * 1000;

// Render блокирует исходящий SMTP на всех тарифах, поэтому письма шлём через
// HTTP API Resend. Без ключа — просто печатаем ссылку в консоль (локальная разработка).
async function sendVerificationEmail(to, name, link) {
  if (!RESEND_API_KEY) {
    console.log(`[mailer] RESEND_API_KEY не настроен. Ссылка для подтверждения ${to}: ${link}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: SMTP_FROM || 'Шабашка <onboarding@resend.dev>',
      to,
      subject: 'Подтвердите почту — Шабашка',
      html: `
        <p>Здравствуйте, ${esc(name)}!</p>
        <p>Подтвердите почту, чтобы завершить регистрацию на Шабашке:</p>
        <p><a href="${esc(link)}">${esc(link)}</a></p>
        <p>Ссылка действует 24 часа. Если вы не регистрировались на Шабашке — просто проигнорируйте это письмо.</p>
      `,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

module.exports = { sendVerificationEmail };
