export type View = 'calculator' | 'rankings';

const TABS: { id: View; label: string }[] = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'rankings', label: 'Rankings' },
];

export function Nav({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <nav className="nav" role="tablist" aria-label="View">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? 'active' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
