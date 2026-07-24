export const CATEGORY_ICONS = {
  'Ремонт': '🔧',
  'Уборка': '🧹',
  'Грузоперевозки': '🚚',
  'Репетиторы': '📚',
  'Красота': '💇',
  'Электрика': '💡',
  'Сантехника': '🚿',
  'Сад и огород': '🌳',
  'Другое': '✨',
};

export function categoryIcon(category) {
  return CATEGORY_ICONS[category] || '🗂️';
}
