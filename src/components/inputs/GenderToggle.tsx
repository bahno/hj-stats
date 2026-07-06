import type { Gender } from '../../data/types';

export function GenderToggle({
  value, onChange,
}: { value: Gender; onChange: (g: Gender) => void }) {
  return (
    <label className="field">
      <span>Gender</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Gender)}>
        <option value="men">Men</option>
        <option value="women">Women</option>
      </select>
    </label>
  );
}
