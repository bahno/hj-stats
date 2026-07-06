import type { Category, CategoryCode } from '../../data/types';

export function CategorySelect({
  categories, value, onChange,
}: { categories: Category[]; value: CategoryCode; onChange: (c: CategoryCode) => void }) {
  return (
    <label className="field">
      <span>Category</span>
      <select value={value} onChange={(e) => onChange(e.target.value as CategoryCode)}>
        {categories.map((c) => (
          <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
        ))}
      </select>
    </label>
  );
}
