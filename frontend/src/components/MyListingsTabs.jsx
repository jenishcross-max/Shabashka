import { Link } from 'react-router-dom';

export default function MyListingsTabs({ active }) {
  return (
    <div className="my-listings-tabs">
      <Link to="/my-orders" className={active === 'orders' ? 'active' : ''}>
        Заказы
      </Link>
      <Link to="/my-vacancies" className={active === 'vacancies' ? 'active' : ''}>
        Вакансии
      </Link>
    </div>
  );
}
