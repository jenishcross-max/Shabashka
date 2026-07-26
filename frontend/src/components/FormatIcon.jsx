const EMOJI = {
  all: '☰',
  offline: '📍',
  online: '🌐',
};

export default function FormatIcon({ name, size = 18 }) {
  const emoji = EMOJI[name];
  if (!emoji) return null;
  return (
    <span className="format-svg" style={{ fontSize: size, lineHeight: 1 }}>
      {emoji}
    </span>
  );
}
