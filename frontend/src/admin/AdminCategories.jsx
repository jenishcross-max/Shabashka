import { useEffect, useState } from 'react';
import { api } from '../api';
import { categoryIcon } from '../categoryIcons';

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api.categoryCounts().then(({ counts }) => setCounts(counts));
  }, []);

  return (
    <div>
      <div className="admin-page-head">
        <h1>Категории</h1>
      </div>
      <div className="admin-card">
        <div className="category-grid">
          {categories.map((c) => (
            <div key={c} className="category-tile" style={{ cursor: 'default' }}>
              <span className="category-icon">{categoryIcon(c)}</span>
              <span>
                <span className="category-name">{c}</span>
                <span className="category-count">{counts[c] || 0} открытых заказов</span>
              </span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          Список категорий фиксирован в коде (backend/src/categories.js). Редактирование через панель
          пока не реализовано.
        </p>
      </div>
    </div>
  );
}
