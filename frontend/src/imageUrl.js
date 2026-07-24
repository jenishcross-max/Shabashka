export function imageUrl(imagePath) {
  if (!imagePath) return null;
  const base = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api$/, '') : '';
  return `${base}${imagePath}`;
}
