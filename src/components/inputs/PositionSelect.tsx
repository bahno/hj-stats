import { WheelPicker, type WheelOption } from './WheelPicker';
import { placeClass } from '../placement';

export function PositionSelect({
  value,
  onChange,
  max = 16,
  rows,
}: {
  value: number;
  onChange: (p: number) => void;
  max?: number;
  rows?: number;
}) {
  const options: WheelOption[] = Array.from({ length: max }, (_, i) => ({
    value: i + 1,
    label: ordinal(i + 1),
    className: placeClass(i + 1),
  }));
  return (
    <div className="field">
      <span>Position</span>
      <WheelPicker options={options} value={value} onChange={onChange} ariaLabel="Position" rows={rows} />
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
