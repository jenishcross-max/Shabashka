const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const EMPLOYMENT_TYPES = require('../employmentTypes');
const EXPERIENCE_LEVELS = require('../experienceLevels');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
const EMPLOYMENT_VALUES = EMPLOYMENT_TYPES.map((t) => t.value);
const EXPERIENCE_VALUES = EXPERIENCE_LEVELS.map((t) => t.value);

const VACANCY_FIELDS = `
  vacancies.id, vacancies.title, vacancies.description, vacancies.category,
  vacancies.employment_type, vacancies.city, vacancies.address, vacancies.work_format,
  vacancies.experience, vacancies.requirements, vacancies.conditions,
  vacancies.salary_min, vacancies.salary_max, vacancies.schedule,
  vacancies.whatsapp_phone, vacancies.status, vacancies.views, vacancies.pinned,
  vacancies.created_at,
  vacancies.user_id, users.name AS owner_name
`;

const WORK_FORMATS = ['online', 'offline'];

const SORTS = {
  new: 'vacancies.pinned DESC, vacancies.created_at DESC',
  salaryDesc: 'vacancies.pinned DESC, vacancies.salary_max IS NULL, vacancies.salary_max DESC',
  salaryAsc: 'vacancies.pinned DESC, vacancies.salary_min IS NULL, vacancies.salary_min ASC',
  popular: 'vacancies.pinned DESC, vacancies.views DESC',
};

function toId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

router.get('/employment-types', (_req, res) => {
  res.json({ employmentTypes: EMPLOYMENT_TYPES });
});

router.get('/experience-levels', (_req, res) => {
  res.json({ experienceLevels: EXPERIENCE_LEVELS });
});

router.get(
  '/category-counts',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      "SELECT category, COUNT(*)::int AS count FROM vacancies WHERE status = 'open' GROUP BY category"
    );
    const counts = Object.fromEntries(rows.map((r) => [r.category, r.count]));
    res.json({ counts });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { city, q, sort, employmentType } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;

    const knownCategories = await categoriesRepo.listNames();
    const categories = String(req.query.category || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => knownCategories.includes(c));

    const clauses = ["vacancies.status = 'open'"];
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (categories.length) {
      const placeholders = categories.map((c) => addParam(c)).join(',');
      clauses.push(`vacancies.category IN (${placeholders})`);
    }
    if (employmentType && EMPLOYMENT_VALUES.includes(employmentType)) {
      clauses.push(`vacancies.employment_type = ${addParam(employmentType)}`);
    }
    if (city) {
      clauses.push(`vacancies.city ILIKE ${addParam(`%${city}%`)}`);
    }
    if (q) {
      const p = addParam(`%${q}%`);
      clauses.push(`(vacancies.title ILIKE ${p} OR vacancies.description ILIKE ${p})`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;
    const orderBy = SORTS[sort] || SORTS.new;

    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM vacancies ${where}`, params)).rows[0].n;

    const limitPlaceholder = addParam(limit);
    const offsetPlaceholder = addParam(offset);
    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id
       ${where} ORDER BY ${orderBy} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );

    res.json({ vacancies: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.user_id = $1 ORDER BY vacancies.created_at DESC`,
      [req.user.id]
    );
    res.json({ vacancies: rows });
  })
);

// Пакетная выборка по id (для избранного) — не увеличивает счётчик просмотров
router.get(
  '/batch',
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter(Number.isInteger)
      .slice(0, 100);
    if (ids.length === 0) return res.json({ vacancies: [] });

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id IN (${placeholders})`,
      ids
    );
    res.json({ vacancies: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Вакансия не найдена' });

    await db.query('UPDATE vacancies SET views = views + 1 WHERE id = $1', [id]);
    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Вакансия не найдена' });
    res.json({ vacancy: row });
  })
);

async function validateVacancyFields(body, { partial }) {
  const {
    title,
    description,
    category,
    employment_type,
    city,
    address,
    work_format,
    experience,
    requirements,
    conditions,
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
    const knownCategories = await categoriesRepo.listNames();
    if (!knownCategories.includes(category)) errors.push('Некорректная категория');
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
  if (!partial || work_format !== undefined) {
    if (!WORK_FORMATS.includes(work_format)) errors.push('Укажите формат работы — онлайн или офлайн');
    else result.work_format = work_format;
  }
  if (!partial || experience !== undefined) {
    if (!EXPERIENCE_VALUES.includes(experience)) errors.push('Укажите требуемый опыт работы');
    else result.experience = experience;
  }
  if (!partial || requirements !== undefined) {
    const trimmed = String(requirements || '').trim();
    if (trimmed.length > 2000) errors.push('Требования слишком длинные (макс. 2000 символов)');
    else result.requirements = trimmed || null;
  }
  if (!partial || conditions !== undefined) {
    const trimmed = String(conditions || '').trim();
    if (trimmed.length > 2000) errors.push('Условия слишком длинные (макс. 2000 символов)');
    else result.conditions = trimmed || null;
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
  if (result.salary_min != null && result.salary_max != null && result.salary_min > result.salary_max) {
    errors.push('Минимальная зарплата не может быть больше максимальной');
  }

  return { errors, result };
}

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { errors, result } = await validateVacancyFields(req.body || {}, { partial: false });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const inserted = await db.query(
      `INSERT INTO vacancies
        (user_id, title, description, category, employment_type, city, address, work_format,
         experience, requirements, conditions, salary_min, salary_max, schedule, whatsapp_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [
        req.user.id,
        result.title,
        result.description,
        result.category,
        result.employment_type,
        result.city,
        result.address,
        result.work_format,
        result.experience,
        result.requirements,
        result.conditions,
        result.salary_min,
        result.salary_max,
        result.schedule,
        result.whatsapp_phone,
      ]
    );

    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = $1`,
      [inserted.rows[0].id]
    );

    res.status(201).json({ vacancy: rows[0] });
  })
);

async function loadOwnedVacancy(req, res) {
  const id = toId(req.params.id);
  if (id === null) {
    res.status(404).json({ error: 'Вакансия не найдена' });
    return null;
  }
  const { rows } = await db.query('SELECT * FROM vacancies WHERE id = $1', [id]);
  const vacancy = rows[0];
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

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const vacancy = await loadOwnedVacancy(req, res);
    if (!vacancy) return;

    const values = [];
    const updates = [];
    const addUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (req.body?.status !== undefined) {
      if (!['open', 'closed'].includes(req.body.status)) {
        return res.status(400).json({ error: 'Статус может быть только open или closed' });
      }
      addUpdate('status', req.body.status);
    }

    const editableKeys = [
      'title',
      'description',
      'category',
      'employment_type',
      'city',
      'address',
      'work_format',
      'experience',
      'requirements',
      'conditions',
      'salary_min',
      'salary_max',
      'schedule',
      'whatsapp_phone',
    ];
    const hasEditableField = editableKeys.some((k) => req.body?.[k] !== undefined);
    if (hasEditableField) {
      const { errors, result } = await validateVacancyFields(req.body, { partial: true });
      if (errors.length) return res.status(400).json({ error: errors[0] });
      for (const key of editableKeys) {
        if (result[key] !== undefined) addUpdate(key, result[key]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(vacancy.id);
    await db.query(`UPDATE vacancies SET ${updates.join(', ')} WHERE id = $${values.length}`, values);

    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = $1`,
      [vacancy.id]
    );
    res.json({ vacancy: rows[0] });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const vacancy = await loadOwnedVacancy(req, res);
    if (!vacancy) return;

    await db.query('DELETE FROM vacancies WHERE id = $1', [vacancy.id]);
    res.status(204).end();
  })
);

module.exports = router;
