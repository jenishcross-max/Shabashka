const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { messageLimiter } = require('../rateLimit');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

const MAX_BODY = 2000;

function toId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

function validateBody(raw) {
  const body = String(raw || '').trim();
  if (!body) return { error: 'Введите текст сообщения' };
  if (body.length > MAX_BODY) return { error: `Сообщение слишком длинное (макс. ${MAX_BODY} символов)` };
  return { body };
}

// Ветка вместе с данными вакансии и именем собеседника — с проверкой,
// что текущий пользователь действительно её участник.
async function loadParticipantConversation(id, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.vacancy_id, c.seeker_id, c.employer_id, c.created_at,
            v.title AS vacancy_title, v.status AS vacancy_status,
            seeker.name AS seeker_name, seeker.phone AS seeker_phone,
            employer.name AS employer_name, employer.phone AS employer_phone
     FROM conversations c
     JOIN vacancies v ON v.id = c.vacancy_id
     JOIN users seeker ON seeker.id = c.seeker_id
     JOIN users employer ON employer.id = c.employer_id
     WHERE c.id = $1`,
    [id]
  );
  const conversation = rows[0];
  if (!conversation) return null;
  if (conversation.seeker_id !== userId && conversation.employer_id !== userId) return 'forbidden';
  return conversation;
}

// Собеседник и роль — то, что нужно фронтенду для отображения ветки
function shapeConversation(c, userId) {
  const iAmSeeker = c.seeker_id === userId;
  return {
    id: c.id,
    vacancy_id: c.vacancy_id,
    vacancy_title: c.vacancy_title,
    vacancy_status: c.vacancy_status,
    created_at: c.created_at,
    my_role: iAmSeeker ? 'seeker' : 'employer',
    other_name: iAmSeeker ? c.employer_name : c.seeker_name,
    other_phone: iAmSeeker ? c.employer_phone : c.seeker_phone,
  };
}

// Начать переписку по вакансии (или получить уже существующую) и сразу отправить сообщение
router.post(
  '/',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const vacancyId = toId(req.body?.vacancyId);
    if (vacancyId === null) return res.status(400).json({ error: 'Не указана вакансия' });

    const { body, error } = validateBody(req.body?.message);
    if (error) return res.status(400).json({ error });

    const { rows: vacancyRows } = await db.query('SELECT id, user_id, status FROM vacancies WHERE id = $1', [
      vacancyId,
    ]);
    const vacancy = vacancyRows[0];
    if (!vacancy) return res.status(404).json({ error: 'Вакансия не найдена' });
    if (vacancy.user_id === req.user.id) {
      return res.status(400).json({ error: 'Это ваша вакансия — написать самому себе нельзя' });
    }
    if (vacancy.status !== 'open') {
      return res.status(400).json({ error: 'Вакансия закрыта, откликнуться уже нельзя' });
    }

    // ON CONFLICT DO UPDATE (а не DO NOTHING) — чтобы RETURNING отдал строку
    // и при повторном обращении, когда ветка уже существует.
    const { rows: convRows } = await db.query(
      `INSERT INTO conversations (vacancy_id, seeker_id, employer_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (vacancy_id, seeker_id) DO UPDATE SET last_message_at = NOW()
       RETURNING id`,
      [vacancyId, req.user.id, vacancy.user_id]
    );
    const conversationId = convRows[0].id;

    await db.query('INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)', [
      conversationId,
      req.user.id,
      body,
    ]);
    await db.query('UPDATE conversations SET last_message_at = NOW() WHERE id = $1', [conversationId]);

    const conversation = await loadParticipantConversation(conversationId, req.user.id);
    res.status(201).json({ conversation: shapeConversation(conversation, req.user.id) });
  })
);

// Счётчик непрочитанного для значка в шапке.
// Определён до '/:id', иначе Express принял бы 'unread-count' за id.
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.sender_id <> $1 AND m.read_at IS NULL
         AND (c.seeker_id = $1 OR c.employer_id = $1)`,
      [req.user.id]
    );
    res.json({ count: rows[0].n });
  })
);

// Все мои переписки — и там, где я откликался, и там, где я работодатель
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT c.id, c.vacancy_id, c.seeker_id, c.employer_id, c.last_message_at,
              v.title AS vacancy_title, v.status AS vacancy_status,
              seeker.name AS seeker_name, employer.name AS employer_name,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
                ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
                AND m.sender_id <> $1 AND m.read_at IS NULL)::int AS unread
       FROM conversations c
       JOIN vacancies v ON v.id = c.vacancy_id
       JOIN users seeker ON seeker.id = c.seeker_id
       JOIN users employer ON employer.id = c.employer_id
       WHERE c.seeker_id = $1 OR c.employer_id = $1
       ORDER BY c.last_message_at DESC`,
      [req.user.id]
    );

    const conversations = rows.map((c) => {
      const iAmSeeker = c.seeker_id === req.user.id;
      return {
        id: c.id,
        vacancy_id: c.vacancy_id,
        vacancy_title: c.vacancy_title,
        vacancy_status: c.vacancy_status,
        last_message_at: c.last_message_at,
        last_message: c.last_message,
        unread: c.unread,
        my_role: iAmSeeker ? 'seeker' : 'employer',
        other_name: iAmSeeker ? c.employer_name : c.seeker_name,
      };
    });
    res.json({ conversations });
  })
);

// Ветка целиком; открытие ветки помечает входящие как прочитанные
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Переписка не найдена' });

    const conversation = await loadParticipantConversation(id, req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Переписка не найдена' });
    if (conversation === 'forbidden') return res.status(403).json({ error: 'Это не ваша переписка' });

    // Отметка о прочтении и выборка сообщений не зависят друг от друга
    // (read_at клиенту не отдаётся), поэтому идут параллельно — база далеко,
    // и каждый лишний последовательный запрос заметно тормозит открытие ветки.
    const [, { rows: messages }] = await Promise.all([
      db.query(
        'UPDATE messages SET read_at = NOW() WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL',
        [id, req.user.id]
      ),
      db.query(
        `SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
         ORDER BY m.id ASC`,
        [id]
      ),
    ]);

    res.json({ conversation: shapeConversation(conversation, req.user.id), messages });
  })
);

router.post(
  '/:id/messages',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Переписка не найдена' });

    const { body, error } = validateBody(req.body?.body);
    if (error) return res.status(400).json({ error });

    const conversation = await loadParticipantConversation(id, req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Переписка не найдена' });
    if (conversation === 'forbidden') return res.status(403).json({ error: 'Это не ваша переписка' });

    const { rows } = await db.query(
      'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at',
      [id, req.user.id, body]
    );
    await db.query('UPDATE conversations SET last_message_at = NOW() WHERE id = $1', [id]);

    res.status(201).json({ message: { ...rows[0], sender_name: req.user.name } });
  })
);

module.exports = router;
