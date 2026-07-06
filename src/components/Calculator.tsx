import { useMemo, useState } from 'react';
import type { CategoryCode, Gender } from '../data/types';
import { categories, placingPoints, scoringTable } from '../engine/data';
import { availableMarks } from '../engine/marks';
import { resultScore } from '../engine/score';
import { GenderToggle } from './inputs/GenderToggle';
import { HeightSelect } from './inputs/HeightSelect';
import { CategorySelect } from './inputs/CategorySelect';
import { PositionSelect } from './inputs/PositionSelect';

export function Calculator() {
  const [gender, setGender] = useState<Gender>('men');
  const [category, setCategory] = useState<CategoryCode>('OW');
  const [position, setPosition] = useState(1);

  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const [height, setHeight] = useState(marks[0]);
  const effectiveHeight = marks.includes(height) ? height : marks[0];

  const score = resultScore(
    scoringTable, placingPoints, gender, effectiveHeight, position, category,
  );

  return (
    <section className="card">
      <div className="fields">
        <GenderToggle value={gender} onChange={setGender} />
        <HeightSelect marks={marks} value={effectiveHeight} onChange={setHeight} />
        <CategorySelect categories={categories} value={category} onChange={setCategory} />
        <PositionSelect value={position} onChange={setPosition} />
      </div>
      <div className="result">
        <div className="score-label">Ranking Score</div>
        <div className="score" data-testid="ranking-score">{score.total}</div>
        <div className="breakdown" data-testid="breakdown">
          Performance {score.performance} · Placing {score.placing}
        </div>
      </div>
    </section>
  );
}
