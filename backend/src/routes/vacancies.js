const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const EMPLOYMENT_TYPES = require('../employmentTypes');

const router = express.Router();
const EMPLOYMENT_VALUES = EMPLOYMENT_TYPES.map((t) => t.value);

const VACANCY_FIELDS = `
  vacancies.id, vacancies.title, vacancies.description, vacancies.category,
  vacancies.employment_type, vacancies.city, vacancies.address,
  vacancies.salary_min, vacancies.salary_max, vacancies.schedule,
  vacancies.whatsapp_phone, vacancies.status, vacancies.views, vacancies.pinned,
  vacancies.created_at,
  vacancies.user_id, users.name AS owner_name
`;

const SORTS = {
  new: 'vacancies.pinned DESC, vacancies.created_at DESC',
  salaryDesc: 'vacancies.pinned DESC, vacancies.salary_max IS NULL, vacancies.salary_max DESC',
  salaryAsc: 'vacancies.pinned DESC, vacancies.salary_min IS NULL, vacancies.salary_min ASC',
  popular: 'vacancies.pinned DESC, vacancies.views DESC',
};

router.get('/employment-types', (_req, res) => {
  res.json({ employmentTypes: EMPLOYMENT_TYPES });
});

router.get('/category-counts', (_req, res) => {
  const rows = db
    .prepare("SELECT category, COUNT(*) AS count FROM vacancies WHERE status = 'open' GROUP BY category")
    .all();
  const counts = Object.fromEntries(rows.map((r) => [r.category, r.count]));
  res.json({ counts });
});

router.get('/', (req, res) => {
  const { city, q, sort, employmentType } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const offset = (page - 1) * limit;

  const knownCategories = categoriesRepo.listNames();
  const categories = String(req.query.category || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => knownCategories.includes(c));

  const clauses = ["vacancies.status = 'open'"];
  const params = {};

  if (categories.length) {
    const placeholders = categories.map((_, i) => `@cat${i}`).join(',');
    categories.forEach((c, i) => {
      params[`cat${i}`] = c;
    });
    clauses.push(`vacancies.category IN (${placeholders})`);
  }
  if (employmentType && EMPLOYMENT_VALUES.includes(employmentType)) {
    clauses.push('vacancies.employment_type = @employmentType');
    params.employmentType = employmentType;
  }
  if (city) {
    clauses.push('vacancies.city LIKE @city');
    params.city = `%${city}%`;
  }
  if (q) {
    clauses.push('(vacancies.title LIKE @q OR vacancies.description LIKE @q)');
    params.q = `%${q}%`;
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const orderBy = SORTS[sort] || SORTS.new;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM vacancies ${where}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id
       ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  res.json({ vacancies: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.user_id = ? ORDER BY vacancies.created_at DESC`
    )
    .all(req.user.id);
  res.json({ vacancies: rows });
});

// Пакетная выборка по id (для избранного) — не увеличивает счётчик просмотров
router.get('/batch', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter(Number.isInteger)
    .slice(0, 100);
  if (ids.length === 0) return res.json({ vacancies: [] });

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id IN (${placeholders})`
    )
    .all(...ids);
  res.json({ vacancies: rows });
});

router.get('/:id', (req, res) => {
  db.prepare('UPDATE vacancies SET views = views + 1 WHERE id = ?').run(req.params.id);
  const row = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Вакансия не найдена' });
  res.json({ vacancy: row });
});

function validateVacancyFields(body, { partial }) {
  const {
    title,
    description,
    category,
    employment_type,
    city,
    address,
    salary_min,
    salary_max,
    schedule,
    whatsapp_phone,
  } = body;
  const errors = [];
  const result = {};

  if (!partial || title !== undefined) {
    if (!title || !title.trim()) errors.push('Укажите название вакансии');
    else result.title = title.trim();
  }
  if (!partial || description !== undefined) {
    if (!description || !description.trim()) errors.push('Опишите вакансию');
    else result.description = description.trim();
  }
  if (!partial || category !== undefined) {
    if (!categoriesRepo.listNames().includes(category)) errors.push('Некорректная категория');
    else result.category = category;
  }
  if (!partial || employment_type !== undefined) {
    if (!EMPLOYMENT_VALUES.includes(employment_type)) errors.push('Некорректный тип занятости');
    else result.employment_type = employment_type;
  }
  if (!partial || city !== undefined) {
    if (!city || !city.trim()) errors.push('Укажите город');
    else result.city = city.trim();
  }
  if (!partial || address !== undefined) {
    const trimmed = String(address || '').trim();
    if (trimmed.length > 200) errors.push('Адрес слишком длинный (макс. 200 символов)');
    else result.address = trimmed || null;
  }
  if (!partial || schedule !== undefined) {
    const trimmed = String(schedule || '').trim();
    if (trimmed.length > 120) errors.push('График слишком длинный (макс. 120 символов)');
    else result.schedule = trimmed || null;
  }
  if (!partial || whatsapp_phone !== undefined) {
    const phone = String(whatsapp_phone || '').replace(/[^\d+]/g, '');
    if (phone.length < 9) errors.push('Укажите корректный номер WhatsApp');
    else result.whatsapp_phone = phone;
  }
  if (!partial || salary_min !== undefined) {
    const value = salary_min ? Number(salary_min) : null;
    if (salary_min && (!Number.isFinite(value) || value < 0)) errors.push('Некорректная минимальная зарплата');
    else result.salary_min = value;
  }
  if (!partial || salary_max !== undefined) {
    const value = salary_max ? Number(salary_max) : null;
    if (salary_max && (!Number.isFinite(value) || value < 0)) errors.push('Некорректная максимальная зарплата');
    else result.salary_max = value;
  }
  if (
    result.salary_min != null &&
    result.salary_max != null &&
    result.salary_min > result.salary_max
  ) {
    errors.push('Минимальная зарплата не может быть больше максимальной');
  }

  return { errors, result };
}

router.post('/', requireAuth, (req, res) => {
  const { errors, result } = validateVacancyFields(req.body || {}, { partial: false });
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const info = db
    .prepare(
      `INSERT INTO vacancies
        (user_id, title, description, category, employment_type, city, address, salary_min, salary_max, schedule, whatsapp_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      result.title,
      result.description,
      result.category,
      result.employment_type,
      result.city,
      result.address,
      result.salary_min,
      result.salary_max,
      result.schedule,
      result.whatsapp_phone
    );

  const vacancy = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json({ vacancy });
});

function loadOwnedVacancy(req, res) {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) {
    res.status(404).json({ error: 'Вакансия не найдена' });
    return null;
  }
  if (vacancy.user_id !== req.user.id) {
    res.status(403).json({ error: 'Это не ваша вакансия' });
    return null;
  }
  return vacancy;
}

router.patch('/:id', requireAuth, (req, res) => {
  const vacancy = loadOwnedVacancy(req, res);
  if (!vacancy) return;

  const updates = [];
  const values = [];

  if (req.body?.status !== undefined) {
    if (!['open', 'closed'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Статус может быть только open или closed' });
    }
    updates.push('status = ?');
    values.push(req.body.status);
  }

  const editableKeys = [
    'title',
    'description',
    'category',
    'employment_type',
    'city',
    'address',
    'salary_min',
    'salary_max',
    'schedule',
    'whatsapp_phone',
  ];
  const hasEditableField = editableKeys.some((k) => req.body?.[k] !== undefined);
  if (hasEditableField) {
    const { errors, result } = validateVacancyFields(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });
    for (const key of editableKeys) {
      if (result[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(result[key]);
      }
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

  values.push(vacancy.id);
  db.prepare(`UPDATE vacancies SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db
    .prepare(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = ?`
    )
    .get(vacancy.id);
  res.json({ vacancy: updated });
});

router.delete('/:id', requireAuth, (req, res) => {
  const vacancy = loadOwnedVacancy(req, res);
  if (!vacancy) return;

  db.prepare('DELETE FROM vacancies WHERE id = ?').run(vacancy.id);
  res.status(204).end();
});

module.exports = router;
