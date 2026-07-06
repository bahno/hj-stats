export function PositionSelect({
  value, onChange, max = 16,
}: { value: number; onChange: (p: number) => void; max?: number }) {
  const positions = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <label className="field">
      <span>Position</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {positions.map((p) => (
          <option key={p} value={p}>{ordinal(p)}</option>
        ))}
      </select>
    </label>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
