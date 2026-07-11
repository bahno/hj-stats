import type { RankingType, Gender } from '../../data/types';

// Left-to-right order the segments render in, matching the CSS translateX steps.
const SEGMENTS: { value: RankingType; text: string }[] = [
  { value: 'world', text: 'World' },
  { value: 'european', text: 'European' },
  { value: 'road', text: 'Road To' },
];

export function RankingTypeToggle({
  value,
  onChange,
  gender,
  label = 'Ranking',
}: {
  value: RankingType;
  gender: Gender;
  onChange: (g: RankingType) => void;
  label?: string;
}) {
  return (
    <div
      className={`ranking-type-switch ${value}`}
      role="radiogroup"
      aria-label={label}
    >
      <span className={`ranking-type-knob ${gender}`} aria-hidden />
      {/* Each segment is its own button so it fills its whole grid cell edge
          to edge — a single button relying on which nested span was clicked
          left the padding above/below the text (and the knob) dead. */}
      {SEGMENTS.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          className={`ranking-type-label ${s.value}`}
          onClick={() => onChange(s.value)}
        >
          {s.text}
        </button>
      ))}
    </div>
  );
}
