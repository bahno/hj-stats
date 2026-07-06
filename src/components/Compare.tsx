import { useMemo, useState } from 'react';
import type { CategoryCode, Gender } from '../data/types';
import { CATEGORY_CODES } from '../data/types';
import { categories, placingPoints, scoringTable } from '../engine/data';
import { availableMarks, defaultHeightFor } from '../engine/marks';
import { compareCategories, resultScore } from '../engine/score';
import { GenderToggle } from './inputs/GenderToggle';
import { HeightSelect } from './inputs/HeightSelect';
import { PositionSelect } from './inputs/PositionSelect';
import { CategoryBarChart } from './charts/CategoryBarChart';
import { ScoreVsHeightChart, type HeightSeriesPoint } from './charts/ScoreVsHeightChart';

const ALL = [...CATEGORY_CODES] as CategoryCode[];

export function Compare() {
  const [gender, setGender] = useState<Gender>('men');
  const [position, setPosition] = useState(1);
  const [height, setHeight] = useState(() => defaultHeightFor(scoringTable, 'men'));
  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const effectiveHeight = marks.includes(height)
    ? height
    : defaultHeightFor(scoringTable, gender);

  function handleGender(next: Gender) {
    setGender(next);
    setHeight(defaultHeightFor(scoringTable, next));
  }

  const rows = compareCategories(scoringTable, placingPoints, gender, effectiveHeight, position, ALL);

  const series: HeightSeriesPoint[] = useMemo(() => {
    // sample every mark ascending; skip marks that throw (all marks are valid here)
    return [...marks].sort((a, b) => a - b).map((m) => {
      const point: HeightSeriesPoint = { height: m };
      for (const c of ALL) {
        point[c] = resultScore(scoringTable, placingPoints, gender, m, position, c).total;
      }
      return point;
    });
  }, [marks, gender, position]);

  return (
    <section className={`card wide ${gender}`}>
      <div className="fields">
        <GenderToggle value={gender} onChange={handleGender} />
        <HeightSelect marks={marks} value={effectiveHeight} onChange={setHeight} />
        <PositionSelect value={position} onChange={setPosition} />
      </div>
      <h2>Ranking score by category</h2>
      <CategoryBarChart rows={rows} />
      <h2>Score vs height</h2>
      <ScoreVsHeightChart data={series} categories={ALL} />
      <table className="numbers">
        <thead><tr><th>Category</th><th>Performance</th><th>Placing</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} data-testid="compare-row">
              <td>{r.category}</td><td>{r.performance}</td><td>{r.placing}</td><td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Categories shown: {categories.map((c) => c.code).join(', ')}</p>
    </section>
  );
}
