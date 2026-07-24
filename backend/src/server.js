require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// В проде отдаём собранный React-фронтенд из того же сервера (Render/Railway free tier)
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

app.listen(PORT, () => {
  console.log(`Шабашка КГ API запущен на порту ${PORT}`);
});
