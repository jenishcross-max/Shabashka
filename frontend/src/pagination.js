export function pageList(page, pages) {
  const set = new Set([1, pages, page, page - 1, page + 1]);
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of list) {
    if (prev && p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}
