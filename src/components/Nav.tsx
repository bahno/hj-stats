export type View = 'calculator' | 'rankings' | 'account';

// Rankings leads: it is the landing view, and it is the only one that covers all
// 36 event groups. The calculator is still high-jump-only.
const TABS: { id: View; label: string }[] = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'calculator', label: 'Calculator' },
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
