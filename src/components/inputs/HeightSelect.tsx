export function HeightSelect({
  marks, value, onChange,
}: { marks: number[]; value: number; onChange: (m: number) => void }) {
  return (
    <label className="field">
      <span>Height</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {marks.map((m) => (
          <option key={m} value={m}>{m.toFixed(2)}m</option>
        ))}
      </select>
    </label>
  );
}
