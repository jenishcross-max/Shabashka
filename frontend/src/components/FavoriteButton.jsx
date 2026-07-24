import { useFavorites } from '../context/FavoritesContext';

export default function FavoriteButton({ orderId, className = '' }) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(orderId);

  return (
    <button
      type="button"
      className={`favorite-btn${active ? ' active' : ''} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(orderId);
      }}
      aria-label={active ? 'Убрать из избранного' : 'В избранное'}
      title={active ? 'Убрать из избранного' : 'В избранное'}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
