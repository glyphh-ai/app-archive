/**
 * drop-page.ts — A DROP STAYS ITS HEIGHT (his order, 2026-10-09: "the list of
 * devices could get insane so needs to stay a deliberate height … they should
 * paginate", and "the same for the models list"). Every chip drop that lists
 * an open-ended set (machines, folders, models) shows DROP_PAGE rows and a
 * ‹ 1/3 › pager under them; a search filters the whole set, then pages it.
 */

/** Rows per page in a chip drop. */
export const DROP_PAGE = 6;

/** One page of `items`: the page clamped into range, and how many there are. Pure. */
export function pageSlice<T>(items: readonly T[], page: number, size: number = DROP_PAGE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.max(0, Math.min(Math.floor(page) || 0, pages - 1));
  return { items: items.slice(at * size, (at + 1) * size), page: at, pages };
}

/** The ‹ n/m › bar under a drop's list; null when everything fits on one page. */
export function dropPager(page: number, pages: number, onPage: (p: number) => void): HTMLElement | null {
  if (pages <= 1) return null;
  const bar = document.createElement("div");
  bar.className = "pagination-bar drop-pager";
  const nav = document.createElement("div");
  nav.className = "pagination-nav";
  const mk = (label: string, to: number, disabled: boolean, aria: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pagination-btn";
    b.textContent = label;
    b.disabled = disabled;
    b.setAttribute("aria-label", aria);
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.stopPropagation(); onPage(to); });
    return b;
  };
  const info = document.createElement("span");
  info.className = "pagination-info";
  info.textContent = `${page + 1}/${pages}`;
  nav.append(mk("‹", page - 1, page === 0, "Previous page"), info, mk("›", page + 1, page >= pages - 1, "Next page"));
  bar.appendChild(nav);
  return bar;
}
