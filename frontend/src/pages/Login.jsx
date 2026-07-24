import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token, user } = await api.login(form);
      login(token, user);
      navigate(location.state?.from?.pathname || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="card-header">
        <span className="brand">
          <span className="brand-mark">Ш</span>
          Шабашка<span>.kg</span>
        </span>
      </div>
      <div className="card-body">
        <h1>Вход для заказчиков</h1>
        <p className="subtitle">
          Регистрация нужна только тем, кто размещает заказы. Чтобы откликнуться на заказ, вход не требуется.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Телефон</span>
            <input
              type="tel"
              required
              placeholder="+996 700 000 000"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Пароль</span>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p className="switch-line">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
