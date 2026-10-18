import { Link } from 'react-router-dom';
import { LANDINGS, landingPath } from '../landings';

// Ссылки на посадочные страницы (см. landings.js): «Работа по профессиям» и
// подборки. Нужны людям — найти свою профессию в один клик — и поисковику: без
// ссылок с главной и соседних страниц посадочные он бы не нашёл.
export default function LandingLinks({ current = null }) {
  const groups = [
    ['Работа по профессиям', LANDINGS.filter((l) => l.group === 'profession')],
    ['Подборки', LANDINGS.filter((l) => l.group === 'collection')],
  ];
  return (
    <section className="section landing-links">
      {groups.map(([title, list]) => (
        <div key={title}>
          <h2>{title}</h2>
          <div className="landing-chips">
            {list.map((l) => (
              <Link
                key={l.slug}
                to={landingPath(l)}
                className="hero-popular-link"
                aria-current={l.slug === current ? 'page' : undefined}
              >
                {l.short}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
