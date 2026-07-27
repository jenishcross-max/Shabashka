import React from 'react';

// Без этого любая необработанная ошибка в React размонтирует всё дерево и
// пользователь видит просто белый экран. Показываем понятное сообщение и
// даём выйти на главную.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Ошибка интерфейса:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="error-boundary">
        <h1>Что-то пошло не так</h1>
        <p>
          Страница не смогла загрузиться. Попробуйте обновить — если не поможет, напишите нам, мы
          починим.
        </p>
        <div className="error-boundary-actions">
          <button type="button" className="submit-btn" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
          <a className="admin-btn-ghost" href="/">
            На главную
          </a>
        </div>
      </div>
    );
  }
}
