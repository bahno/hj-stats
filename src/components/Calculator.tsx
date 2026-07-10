import { useEffect, useMemo, useState } from 'react';
import type { CategoryCode, Gender } from '../data/types';
import { categories, placingPoints, scoringTable } from '../engine/data';
import { availableMarks, defaultHeightFor } from '../engine/marks';
import { resultScore } from '../engine/score';
import { usePreferences } from '../hooks/usePreferences';
import { GenderToggle } from './inputs/GenderToggle';
import { HeightSelect } from './inputs/HeightSelect';
import { CategorySelect } from './inputs/CategorySelect';
import { PositionSelect } from './inputs/PositionSelect';

export function Calculator() {
  const [gender, setGender] = useState<Gender>('men');
  const [category, setCategory] = useState<CategoryCode>('C');
  const [position, setPosition] = useState(1);
  const [height, setHeight] = useState(() => defaultHeightFor(scoringTable, 'men'));

  const { defaultGender, setDefaultGender } = usePreferences();

  // Adopt the saved preference once it loads (only if the user hasn't overridden).
  useEffect(() => {
    if (defaultGender && defaultGender !== gender) {
      setGender(defaultGender);
      setHeight(defaultHeightFor(scoringTable, defaultGender));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGender]);

  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const effectiveHeight = marks.includes(height)
    ? height
    : defaultHeightFor(scoringTable, gender);

  function handleGender(next: Gender) {
    setGender(next);
    setHeight(defaultHeightFor(scoringTable, next));
    void setDefaultGender(next).catch(() => {});
  }

  const score = resultScore(
    scoringTable, placingPoints, gender, effectiveHeight, position, category,
  );

  return (
    <section className={`card calc ${gender}`}>
      <div className="fields">
        <GenderToggle value={gender} onChange={handleGender} />
        <HeightSelect marks={marks} value={effectiveHeight} onChange={setHeight} />
        <CategorySelect categories={categories} value={category} onChange={setCategory} />
        <PositionSelect value={position} onChange={setPosition} />
      </div>
      <div className="result">
        <div className="score-label">Ranking Score</div>
        <div className="crossbar" key={score.total}>
          <div className="score" data-testid="ranking-score">{score.total}</div>
          <span className="beam" aria-hidden />
        </div>
        <div className="breakdown" data-testid="breakdown">
          Performance {score.performance} Placing {score.placing}
        </div>
      </div>
    </section>
  );
}
