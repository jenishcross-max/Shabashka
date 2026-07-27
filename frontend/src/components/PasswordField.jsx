import { useId, useState } from 'react';

// Поле пароля с «глазком». На телефоне попасть по нужным буквам вслепую тяжело,
// и человек бросает регистрацию на середине — возможность подсмотреть свой же
// пароль убирает эту причину отвала.
//
// Кнопка намеренно вынесена из <label>: клик по вложенной в label кнопке
// дополнительно активирует сам label, переключение срабатывает дважды и
// поле остаётся закрытым.
export default function PasswordField({ label = 'Пароль', ...inputProps }) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="password-input">
        <input id={id} type={shown ? 'text' : 'password'} {...inputProps} />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={shown}
          title={shown ? 'Скрыть пароль' : 'Показать пароль'}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-6.5 10-6.5c1.7 0 3.2.5 4.5 1.1M22 12s-3.6 6.5-10 6.5c-1.7 0-3.2-.5-4.5-1.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
