import type { Category, CategoryCode } from '../../data/types';

/**
 * Category is a prestige ladder (OW at the top … F at the bottom), so it reads
 * as a tap-to-pick tier grid rather than a dropdown. The selected chip lights in
 * the gender accent; its full name shows in the caption so long names never
 * crowd the chips.
 */
export function CategorySelect({
  categories, value, onChange,
}: { categories: Category[]; value: CategoryCode; onChange: (c: CategoryCode) => void }) {
  return (
    <div className="field field-stack">
      <span id="category-label">Category</span>
      <div className="cat-grid" role="radiogroup" aria-labelledby="category-label">
        {categories.map((c) => (
          <button
            key={c.code}
            type="button"
            role="radio"
            aria-checked={c.code === value}
            aria-label={`${c.code} — ${c.name}`}
            title={`${c.code} — ${c.name}`}
            data-cat={c.code}
            className={'cat-chip' + (c.code === value ? ' selected' : '')}
            onClick={() => onChange(c.code)}
          >
            {c.code}
          </button>
        ))}
      </div>
    </div>
  );
}
