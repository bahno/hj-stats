import type { Gender } from '../../data/types';

export function GenderToggle({
  value,
  onChange,
  label = 'Gender',
}: {
  value: Gender;
  onChange: (g: Gender) => void;
  label?: string;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value === 'women'}
        aria-label={label}
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
