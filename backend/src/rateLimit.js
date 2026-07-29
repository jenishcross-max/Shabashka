const rateLimit = require('express-rate-limit');

// Вход/регистрация — защита от подбора пароля и спам-регистраций
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
});

// Жалобы — защита от спама жалобами
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много жалоб с этого адреса. Попробуйте позже.' },
});

// Публичное API в целом — базовая защита от злоупотреблений
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, немного помедленнее.' },
});

// Сообщения — защита от спам-рассылки по вакансиям
const messageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много сообщений. Попробуйте через несколько минут.' },
});

// Доска — записки живут шесть часов, и один человек не должен занимать её целиком.
// Лимит на адрес, а не на аккаунт: аккаунт заводится за минуту, адрес — нет.
const boardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много объявлений на доске за час. Попробуйте позже.' },
});

module.exports = { authLimiter, reportLimiter, apiLimiter, messageLimiter, boardLimiter };
