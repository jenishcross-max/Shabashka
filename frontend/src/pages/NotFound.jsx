import { Link } from 'react-router-dom';
import { useMeta, useNoIndex } from '../useMeta';

export default function NotFound() {
  useMeta(
    'Страница не найдена — Шабашка',
    'Такой страницы нет. Посмотрите свежие заказы и вакансии на Шабашке.'
  );
  useNoIndex();

  return (
    <div className="not-found">
      <div className="not-found-code">404</div>
      <h1>Такой страницы нет</h1>
      <p>
        Возможно, объявление удалили или в ссылке опечатка. Посмотрите, что есть сейчас на сайте.
      </p>
      <div className="not-found-actions">
        <Link to="/" className="submit-btn">
          На главную
        </Link>
        <Link to="/orders" className="admin-btn-ghost">
          Все заказы
        </Link>
        <Link to="/vacancies" className="admin-btn-ghost">
          Все вакансии
        </Link>
      </div>
    </div>
  );
}
