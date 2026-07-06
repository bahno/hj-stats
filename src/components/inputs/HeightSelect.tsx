import { WheelPicker, type WheelOption } from './WheelPicker';

export function HeightSelect({
  marks,
  value,
  onChange,
}: {
  marks: number[];
  value: number;
  onChange: (m: number) => void;
}) {
  const options: WheelOption[] = [...marks]
    .sort((a, b) => b - a)
    .map((m) => ({ value: m, label: `${m.toFixed(2)}m` }));
  return (
    <div className="field">
      <span>Height</span>
      <WheelPicker options={options} value={value} onChange={onChange} ariaLabel="Height" />
    </div>
  );
}
