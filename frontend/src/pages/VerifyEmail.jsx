import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Ссылка неполная — не найден код подтверждения');
      return;
    }
    api
      .verifyEmail(token)
      .then(() => {
        setStatus('success');
        refreshUser().catch(() => {});
      })
      .catch((err) => {
        setStatus('error');
        setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="auth-card">
      <div className="card-header">
        <Logo size="sm" />
      </div>
      <div className="card-body">
        {status === 'loading' && <p className="status-msg">Проверяем ссылку…</p>}
        {status === 'success' && (
          <>
            <h1>Почта подтверждена</h1>
            <p className="subtitle">Спасибо! Теперь можно пользоваться сайтом без ограничений.</p>
            <Link className="submit-btn" to="/">На главную</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <h1>Не получилось подтвердить</h1>
            <p className="status-msg error">{error}</p>
            <p className="subtitle">
              Войдите в аккаунт — там можно будет отправить письмо ещё раз.
            </p>
            <Link className="submit-btn" to="/login">Войти</Link>
          </>
        )}
      </div>
    </div>
  );
}
