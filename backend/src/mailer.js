const { RESEND_API_KEY, SMTP_FROM } = process.env;

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
        <p>Здравствуйте, ${name}!</p>
        <p>Подтвердите почту, чтобы завершить регистрацию на Шабашке:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Ссылка действует 24 часа. Если вы не регистрировались на Шабашке — просто проигнорируйте это письмо.</p>
      `,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

module.exports = { sendVerificationEmail };
