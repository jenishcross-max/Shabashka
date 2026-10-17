import { NavLink } from 'react-router-dom';

const ITEMS = [
  ['/orders', 'Подработка'],
  ['/vacancies', 'Вакансии'],
  ['/tasks', 'Биржа'],
];

// Три раздела работы под одной кнопкой «Работа» нижней панели: на телефоне
// шапки с разделами нет, и переключаться между ними надо прямо со страницы.
// На компьютере скрыт — там те же разделы в шапке.
export default function WorkSwitcher() {
  return (
    <nav className="work-switcher" aria-label="Разделы работы">
      {ITEMS.map(([to, label]) => (
        <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
