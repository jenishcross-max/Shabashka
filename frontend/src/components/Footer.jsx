import { Link } from 'react-router-dom';
import Logo from './Logo';
import { SOCIALS, SocialIcon } from './SocialLinks';

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
              <Link to="/tasks">Биржа услуг</Link>
            </li>
            <li>
              <Link to="/orders">Все заказы</Link>
            </li>
            <li>
              <Link to="/ads">Объявления: сдам, продам</Link>
            </li>
            <li>
              <Link to="/register">Разместить заказ</Link>
            </li>
            <li>
              <Link to="/favorites">Избранное</Link>
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
              <a href="mailto:ittirek@gmail.com">✉️ ittirek@gmail.com</a>
            </li>
          </ul>
        </div>
        <div>
          <h4>Мы в соцсетях</h4>
          {/* Ссылки нужны не только людям: поисковик идёт по ним с сайта на профили
              и обратно и убеждается, что это один и тот же проект. */}
          <ul>
            {SOCIALS.map((s) => (
              <li key={s.id}>
                <a className="footer-social" href={s.url} target="_blank" rel="noopener noreferrer me">
                  <SocialIcon id={s.id} />
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="copyright">© {new Date().getFullYear()} Шабашка · Tirek IT Studio</p>
    </footer>
  );
}
