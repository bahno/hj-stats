import type { RankingType,Gender } from '../../data/types';

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
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={value === 'road'}
        aria-label={label}
        className={`ranking-type-switch ${value}`}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const next = target.dataset.rankingType as RankingType | undefined;
          if (next) onChange(next);
        }}
      >
        <span className={`ranking-type-knob ${gender}`} aria-hidden />
        <span className={`ranking-type-label world`} data-ranking-type="world">World</span>
        <span className={`ranking-type-label european`} data-ranking-type="european">European</span>
        <span className={`ranking-type-label road`} data-ranking-type="road">Road To</span>
      </button>
    </div>
  );
}
