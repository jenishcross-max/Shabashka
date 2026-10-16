// Все ленты API отвечают { <список>, total, page, pages } — общий шаг для useInfiniteQuery.
export const PAGE_SIZE = 20;
export const nextPage = (last) => (last.page < last.pages ? last.page + 1 : undefined);
