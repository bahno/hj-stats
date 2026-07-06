import type { Category, CategoryCode } from '../../data/types';
import { WheelPicker, type WheelOption } from './WheelPicker'

export function CategorySelect({
  categories, value, onChange,
}: { categories: Category[]; value: CategoryCode; onChange: (c: CategoryCode) => void }) {
  const options: WheelOption[] = [...categories]
    .map((m) => ({ value: categories.indexOf(m), label: `${m.code}` }));
  return (
    <label className="field">
      <span>Category</span>
      <select value={value} onChange={(e) => onChange(e.target.value as CategoryCode)}>
        {categories.map((c) => (
          <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
        ))}
      </select>
    </label>
  );
}
