import { useEffect, useRef, useState } from 'react';

export default function CityAutocomplete({
  value,
  onChange,
  cities,
  placeholder,
  required,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);

  const query = value.trim().toLowerCase();
  const filtered = (
    query ? cities.filter((c) => c.toLowerCase().includes(query)) : cities
  ).slice(0, 8);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function select(city) {
    onChange(city);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        select(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={`city-autocomplete${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <input
        type="text"
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="city-autocomplete-menu">
          {filtered.map((c, i) => (
            <li
              key={c}
              className={i === highlight ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                select(c);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
