import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

// Вход через Google — на /login и /register. Ключ клиента сайт берёт у
// бэкенда (GOOGLE_CLIENT_ID на Render); не задан — кнопки нет вовсе.
//
// Во встроенных браузерах Threads («Barcelona»), Instagram и Facebook Google
// вход не пускает (ошибка «disallowed_useragent»), а приходят к нам как раз
// оттуда. Кнопку, которая не сработает, там не рисуем — подсказываем, как
// открыть сайт в обычном браузере.
const IN_APP_RE = /Barcelona|Instagram|FBAN|FBAV|FB_IAB/i;

let scriptLoading = null;
function loadGoogle() {
  if (!scriptLoading) {
    scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        scriptLoading = null;
        reject(new Error('Google не загрузился. Проверьте интернет и обновите страницу'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptLoading;
}

export default function GoogleSignIn() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const box = useRef(null);
  const [clientId, setClientId] = useState(null);
  const [error, setError] = useState('');
  const inApp = IN_APP_RE.test(navigator.userAgent);
  const back = location.state?.from?.pathname || '/';

  // Google вызывает колбэк, заданный один раз при initialize, — свежие login и
  // navigate он берёт отсюда, а кнопка не перерисовывается на каждый рендер.
  const onCredential = useRef(null);
  onCredential.current = async (credential) => {
    setError('');
    try {
      const { token, user } = await api.googleLogin(credential);
      login(token, user);
      navigate(back);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    api
      .googleConfig()
      .then(({ clientId }) => setClientId(clientId))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId || inApp) return undefined;
    let cancelled = false;
    loadGoogle()
      .then(() => {
        if (cancelled || !box.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => onCredential.current(credential),
        });
        window.google.accounts.id.renderButton(box.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          locale: 'ru',
          width: Math.min(box.current.offsetWidth || 320, 400),
        });
      })
      .catch((err) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, inApp]);

  if (!clientId) return null;
  return (
    <div className="google-signin">
      <div className="auth-divider">
        <span>или</span>
      </div>
      {inApp ? (
        <p className="format-hint">
          Войти через Google можно в обычном браузере: нажмите «⋯» вверху справа и «Открыть в браузере».
        </p>
      ) : (
        <div ref={box} className="google-signin-button" />
      )}
      {error && <p className="status-msg error">{error}</p>}
    </div>
  );
}
