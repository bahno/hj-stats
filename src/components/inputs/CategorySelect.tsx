import type { Category, CategoryCode } from '../../data/types';

/**
 * Category is a prestige ladder, so it renders as a pyramid of tier "leagues":
 * the singular Olympic/World tier (OW) crowning the apex, then the championship
 * tiers (GL/GW/DF), the medals (C/B/A), and the base tiers (F/E/D) along the
 * bottom. Each league is one centred row; the selected chip lights in its tier
 * colour with a white selection ring, and its full name shows in the caption.
 */

// Leagues from apex down to base. Each inner row is ordered high → low prestige
// left-to-right, so the strongest tier of every league sits on the left edge.
const LEAGUES: CategoryCode[][] = [
  ['OW'],
  ['DF', 'GW', 'GL'],
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
];

export function CategorySelect({
  categories, value, onChange,
}: { categories: Category[]; value: CategoryCode; onChange: (c: CategoryCode) => void }) {
  const byCode = new Map<CategoryCode, Category>(categories.map((c) => [c.code, c]));
  return (
    <div className="field">
      <span id="category-label">Category</span>
      <div className="cat-groups" role="radiogroup" aria-labelledby="category-label">
        {LEAGUES.map((league) => (
          <div className="cat-group" key={league.join('-')}>
            {league.map((code) => {
              const c = byCode.get(code);
              if (!c) return null;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={code === value}
                  aria-label={`${c.code} — ${c.name}`}
                  title={`${c.code} — ${c.name}`}
                  data-cat={code}
                  className={'cat-chip' + (code === value ? ' selected' : '')}
                  onClick={() => onChange(code)}
                >
                  {code}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
