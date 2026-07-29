require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const db = require('./db');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const vacancyRoutes = require('./routes/vacancies');
const boardRoutes = require('./routes/board');
const homeRoutes = require('./routes/home');
const conversationRoutes = require('./routes/conversations');
const adminRoutes = require('./routes/admin');
const telegram = require('./telegram');
const social = require('./social');
const metaRoutes = require('./meta');
const { apiLimiter } = require('./rateLimit');

const app = express();
const PORT = process.env.PORT || 4000;

// На Render (и других PaaS) приложение стоит за прокси, который добавляет
// X-Forwarded-For — без этого express-rate-limit падает с ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// CSP выключен: это Vite SPA, тонкая настройка политики под её бандл
// потребовала бы отдельной проверки прод-сборки — остальные защиты helmet включены.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// В проде разрешаем только домен фронтенда; без CORS_ORIGIN (локально) — все origin,
// чтобы не мешать разработке.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Вебхук Telegram — до apiLimiter: пачка апдейтов после простоя иначе упёрлась
// бы в общий лимит, а Telegram счёл бы это сбоем и начал слать их повторно.
app.use('/api/telegram', telegram.router);

// Тоже до apiLimiter: за роликом приходит загрузчик Instagram, и упереться
// в лимит на публикации ему нельзя — второй попытки он не делает.
app.use('/api/social', social.router);

app.use('/api', apiLimiter);
app.use('/api/home', homeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/board', boardRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admin', adminRoutes);
app.use(metaRoutes);

// В проде фронтенд хостится отдельно на Netlify; это на случай локального
// запуска в один процесс или альтернативного деплоя без Netlify.
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function bootstrap() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Шабашка КГ API запущен на порту ${PORT}`);
  });
  // Бот не должен ронять сервер: сайт работает и без импорта объявлений
  telegram.start().catch((err) => console.error('Telegram-бот не запустился:', err));
}

bootstrap().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
