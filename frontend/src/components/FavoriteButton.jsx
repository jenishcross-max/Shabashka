import { useFavorites } from '../context/FavoritesContext';

export default function FavoriteButton({ type = 'order', id, className = '' }) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(type, id);

  return (
    <button
      type="button"
      className={`favorite-btn${active ? ' active' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(type, id);
      }}
      aria-label={active ? 'Убрать из избранного' : 'В избранное'}
      title={active ? 'Убрать из избранного' : 'В избранное'}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
