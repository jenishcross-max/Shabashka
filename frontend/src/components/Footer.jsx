import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-cols">
        <div>
          <div className="footer-brand">
            <Logo size="sm" onDark />
            <span className="footer-studio">Tirek IT Studio</span>
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
        <div>
          <h4>Контакты</h4>
          <ul>
            <li>
              <a href="https://wa.me/996553675070" target="_blank" rel="noopener noreferrer">
                💬 WhatsApp: 0553675070
              </a>
            </li>
            <li>
              <a href="mailto:ittirek@gmail.com">✉️ ittirek@gmail.com</a>
            </li>
          </ul>
        </div>
      </div>
      <p className="copyright">© {new Date().getFullYear()} Шабашка · Tirek IT Studio</p>
    </footer>
  );
}
