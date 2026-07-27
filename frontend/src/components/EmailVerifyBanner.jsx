import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function EmailVerifyBanner() {
  const { user, token } = useAuth();
  const [state, setState] = useState('idle'); // idle | sending | sent | error

  if (!user || user.emailVerified) return null;

  async function handleResend() {
    setState('sending');
    try {
      await api.resendVerification(token);
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="email-verify-banner">
      <span>Подтвердите почту {user.email} — мы отправили письмо со ссылкой.</span>
      {state === 'sent' ? (
        <span>Письмо отправлено ✓</span>
      ) : (
        <button type="button" onClick={handleResend} disabled={state === 'sending'}>
          {state === 'sending' ? 'Отправляем…' : 'Отправить ещё раз'}
        </button>
      )}
      {state === 'error' && <span className="error">Не получилось отправить, попробуйте позже</span>}
    </div>
  );
}
