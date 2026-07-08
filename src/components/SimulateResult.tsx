import { useMemo, useState } from 'react';
import type { CategoryCode, Gender } from '../data/types';
import { categories, scoringTable } from '../engine/data';
import { availableMarks, defaultHeightFor } from '../engine/marks';
import { projectedPlace, recomputeRanking, resultScoreFor } from '../engine/simulate';
import { CategorySelect } from './inputs/CategorySelect';
import { HeightSelect } from './inputs/HeightSelect';
import { PositionSelect } from './inputs/PositionSelect';

type Tone = 'up' | 'down' | 'flat';

function delta(next: number, current: number, betterIsLower: boolean): { text: string; tone: Tone } {
  const d = next - current;
  if (d === 0) return { text: '±0', tone: 'flat' };
  const improved = betterIsLower ? d < 0 : d > 0;
  return { text: `${improved ? '▲' : '▼'} ${Math.abs(d)}`, tone: improved ? 'up' : 'down' };
}

export function SimulateResult({
  gender,
  baseScores,
  currentScore,
  currentPlace,
  peerScores,
}: {
  gender: Gender;
  baseScores: number[];
  currentScore: number;
  currentPlace: number; // current European place
  peerScores: number[]; // European peers' ranking scores (self excluded)
}) {
  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const [mark, setMark] = useState(() => defaultHeightFor(scoringTable, gender));
  const [category, setCategory] = useState<CategoryCode>('A');
  const [place, setPlace] = useState(1);

  const effectiveMark = marks.includes(mark) ? mark : defaultHeightFor(scoringTable, gender);

  const sim = useMemo(() => {
    const simScore = resultScoreFor(gender, effectiveMark, category, place);
    const { newScore, counts, dropped } = recomputeRanking(baseScores, simScore);
    const newPlace = projectedPlace(peerScores, newScore);
    return { simScore, newScore, counts, dropped, newPlace };
  }, [gender, effectiveMark, category, place, baseScores, peerScores]);

  const scoreD = delta(sim.newScore, currentScore, false);
  const placeD = delta(sim.newPlace, currentPlace, true);

  return (
    <div className="simulate">
      <div className="comps-label">Simulate a result</div>
      <div className="fields">
        <HeightSelect marks={marks} value={effectiveMark} onChange={setMark} rows={3} />
        <CategorySelect categories={categories} value={category} onChange={setCategory} />
        <PositionSelect value={place} onChange={setPlace} rows={3} />
      </div>

      <div className="sim-outcome">
        <p className="sim-note">
          This result scores <strong>{sim.simScore}</strong> (mark + placing).
          {sim.counts
            ? sim.dropped != null
              ? ` It replaces your weakest counting result (${sim.dropped}).`
              : ' It joins your counting results.'
            : ' It sits below your five counting results.'}
        </p>

        <div className="lookup-stats">
          <div className={`stat ${scoreD.tone}`}>
            <div className="stat-label">New score</div>
            <div className="stat-value">{sim.newScore}</div>
            <div className={`stat-delta ${scoreD.tone}`}>{scoreD.text}</div>
          </div>
          <div className={`stat ${placeD.tone}`}>
            <div className="stat-label">New European</div>
            <div className="stat-value">#{sim.newPlace}</div>
            <div className={`stat-delta ${placeD.tone}`}>{placeD.text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
