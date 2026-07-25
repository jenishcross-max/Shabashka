import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { categoryIcon } from '../categoryIcons';

export default function AdminCategories() {
  const { token } = useAuth();
  const [categories, setCategories] = useState([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminCategories(token)
      .then(({ categories }) => setCategories(categories))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.adminAddCategory(newName, token);
      setNewName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(c) {
    if (c.order_count > 0) return;
    if (!confirm(`Удалить категорию «${c.name}»?`)) return;
    try {
      await api.adminRemoveCategory(c.id, token);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <p className="status-msg">Загрузка…</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Категории</h1>
      </div>

      <div className="admin-card">
        <h3 className="filter-heading">Добавить категорию</h3>
        <form className="add-category-form" onSubmit={handleAdd}>
          <input
            placeholder="Например: Клининг офисов"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
          />
          <button className="admin-btn-danger" type="submit" disabled={submitting || !newName.trim()}>
            {submitting ? 'Добавляем…' : '+ Добавить'}
          </button>
        </form>
        {error && <p className="status-msg error">{error}</p>}
      </div>

      <div className="admin-card">
        <div className="category-grid">
          {categories.map((c) => (
            <div key={c.id} className="category-tile admin-category-tile">
              <span className="category-icon">{categoryIcon(c.name)}</span>
              <span>
                <span className="category-name">{c.name}</span>
                <span className="category-count">{c.order_count} заказ(ов)</span>
              </span>
              <button
                className="category-remove-btn"
                onClick={() => handleRemove(c)}
                disabled={c.order_count > 0}
                title={c.order_count > 0 ? 'Нельзя удалить: есть заказы с этой категорией' : 'Удалить категорию'}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          Категорию нельзя удалить, пока ею помечен хотя бы один заказ.
        </p>
      </div>
    </div>
  );
}
