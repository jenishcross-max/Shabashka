const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

const transporter =
  SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

// Без настроенного SMTP (например, локальная разработка) просто печатаем
// ссылку в консоль, чтобы не ломать регистрацию из-за отсутствия почты.
async function sendVerificationEmail(to, name, link) {
  if (!transporter) {
    console.log(`[mailer] SMTP не настроен. Ссылка для подтверждения ${to}: ${link}`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Подтвердите почту — Шабашка',
    html: `
      <p>Здравствуйте, ${name}!</p>
      <p>Подтвердите почту, чтобы завершить регистрацию на Шабашке:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Ссылка действует 24 часа. Если вы не регистрировались на Шабашке — просто проигнорируйте это письмо.</p>
    `,
  });
}

module.exports = { sendVerificationEmail };
