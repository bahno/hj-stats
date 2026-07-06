import type { Gender } from '../../data/types';

export function GenderToggle({
  value,
  onChange,
}: {
  value: Gender;
  onChange: (g: Gender) => void;
}) {
  return (
    <div className="field">
      <span>Gender</span>
      <button
        type="button"
        role="switch"
        aria-checked={value === 'women'}
        aria-label="Gender"
        className={`gender-switch ${value}`}
        onClick={() => onChange(value === 'men' ? 'women' : 'men')}
      >
        <span className="gender-knob" aria-hidden />
        <span className="gender-label men">Men</span>
        <span className="gender-label women">Women</span>
      </button>
    </div>
  );
}
