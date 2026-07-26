// Наборы колонок для карточек и страниц объявлений. Вынесены отдельно, потому что
// их использует и список заказов/вакансий, и сводный запрос главной страницы.
const ORDER_FIELDS = `
  orders.id, orders.title, orders.description, orders.category, orders.city, orders.address,
  orders.work_format, orders.budget, orders.whatsapp_phone, orders.status, orders.views, orders.pinned,
  orders.is_example, orders.created_at,
  orders.user_id, users.name AS owner_name
`;

const VACANCY_FIELDS = `
  vacancies.id, vacancies.title, vacancies.description, vacancies.category,
  vacancies.employment_type, vacancies.city, vacancies.address, vacancies.work_format,
  vacancies.experience, vacancies.requirements, vacancies.conditions,
  vacancies.salary_min, vacancies.salary_max, vacancies.schedule,
  vacancies.whatsapp_phone, vacancies.status, vacancies.views, vacancies.pinned,
  vacancies.is_example, vacancies.created_at,
  vacancies.user_id, users.name AS owner_name
`;

module.exports = { ORDER_FIELDS, VACANCY_FIELDS };
