import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';
import CityAutocomplete from '../components/CityAutocomplete';

export default function Register() {
  const { login } = useAuth();
  const cities = useCities();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', city: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token, user } = await api.register(form);
      login(token, user);
      navigate('/orders/new');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="card-header">
        <Logo size="sm" />
      </div>
      <div className="card-body">
        <h1>Регистрация заказчика</h1>
        <p className="subtitle">
          Аккаунт нужен, только чтобы размещать заказы. Исполнителям регистрация не нужна — они
          отвечают через WhatsApp напрямую.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Имя</span>
            <input
              required
              placeholder="Как к вам обращаться"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Телефон для WhatsApp</span>
            <input
              type="tel"
              required
              placeholder="+996 700 000 000"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="label">Город</span>
              <CityAutocomplete
                placeholder="Бишкек"
                cities={cities}
                value={form.city}
                onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              />
            </label>
            <label className="field">
              <span className="label">Пароль</span>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
          </div>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </button>
        </form>
        <p className="switch-line">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
