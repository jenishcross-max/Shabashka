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
const homeRoutes = require('./routes/home');
const conversationRoutes = require('./routes/conversations');
const adminRoutes = require('./routes/admin');
const metaRoutes = require('./meta');
const { apiLimiter } = require('./rateLimit');

const app = express();
const PORT = process.env.PORT || 4000;

// CSP выключен: это Vite SPA, тонкая настройка политики под её бандл
// потребовала бы отдельной проверки прод-сборки — остальные защиты helmet включены.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', apiLimiter);
app.use('/api/home', homeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vacancies', vacancyRoutes);
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
}

bootstrap().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
