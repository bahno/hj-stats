import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [saveError, setSaveError] = useState('');

  const { defaultGender, setDefaultGender } = usePreferences();

  // Adopt the saved preference once it loads — but only until the user picks a
  // gender themselves. Without this latch, a failed save rolls `defaultGender`
  // back, the effect re-fires, and the toggle silently jumps under the user.
  const userChose = useRef(false);
  useEffect(() => {
    if (userChose.current) return;
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
    userChose.current = true;
    setGender(next);
    setHeight(defaultHeightFor(scoringTable, next));
    setSaveError('');
    // The calculator keeps working either way — but say so rather than letting
    // the preference silently fail to persist.
    void setDefaultGender(next).catch(() =>
      setSaveError("Couldn't save this as your default gender."),
    );
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
      {saveError && <p className="lookup-msg">{saveError}</p>}
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
