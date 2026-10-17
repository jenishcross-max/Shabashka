import { useEffect } from 'react';

// Панель, выезжающая снизу, — для меню на телефоне: до пунктов дотягивается
// большой палец, а под ней видно, откуда её открыли. Закрывается по подложке,
// по Esc и сама, когда родитель меняет open (например, после перехода).
export default function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Пока панель открыта, страница под ней не должна прокручиваться пальцем.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
