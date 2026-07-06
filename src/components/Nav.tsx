export type View = 'calculator' | 'compare';

export function Nav({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <nav className="nav">
      <button className={value === 'calculator' ? 'active' : ''} onClick={() => onChange('calculator')}>Calculator</button>
      <button className={value === 'compare' ? 'active' : ''} onClick={() => onChange('compare')}>Compare</button>
    </nav>
  );
}
