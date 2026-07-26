import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-cols">
        <div>
          <div className="footer-brand">
            <Logo size="sm" onDark />
          </div>
          <p>
            Доска объявлений для поиска подработки и мастеров в Кыргызстане. Заказчики размещают
            задачи, исполнители откликаются в WhatsApp или в сообщениях на сайте — без комиссии.
          </p>
        </div>
        <div>
          <h4>Разделы</h4>
          <ul>
            <li>
              <Link to="/orders">Все заказы</Link>
            </li>
            <li>
              <Link to="/register">Разместить заказ</Link>
            </li>
            <li>
              <Link to="/favorites">Избранное</Link>
            </li>
            <li>
              <Link to="/#how">Как это работает</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>Информация</h4>
          <ul>
            <li>
              <Link to="/terms">Условия использования</Link>
            </li>
            <li>
              <Link to="/privacy">Политика конфиденциальности</Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="copyright">© {new Date().getFullYear()} Шабашка</p>
    </footer>
  );
}
