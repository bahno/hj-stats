import { useMemo, useState } from 'react';
import type { CategoryCode, Gender } from '../data/types';
import { categories, scoringTable } from '../engine/data';
import { availableMarks, defaultHeightFor } from '../engine/marks';
import {
  projectedPlace,
  qualifyingPosition,
  recomputeRanking,
  resultScoreFor,
  withinWorldRankingQuota,
} from '../engine/simulate';
import { CategorySelect } from './inputs/CategorySelect';
import { HeightSelect } from './inputs/HeightSelect';
import { PositionSelect } from './inputs/PositionSelect';

type Tone = 'up' | 'down' | 'flat';
export type Source = 'world' | 'birmingham';

function delta(next: number, current: number, betterIsLower: boolean): { text: string; tone: Tone } {
  const d = next - current;
  if (d === 0) return { text: '±0', tone: 'flat' };
  const improved = betterIsLower ? d < 0 : d > 0;
  return { text: `${improved ? '▲' : '▼'} ${Math.abs(d)}`, tone: improved ? 'up' : 'down' };
}

/** Everything needed to simulate against the Road to Birmingham world-rankings pool. */
export interface RoadSimData {
  baseScores: number[]; // the athlete's Birmingham-scoped 5 counting results
  currentScore: number; // their Birmingham-scoped average score
  peerScores: number[]; // world-rankings-pool peers' scores (self excluded)
  nonRankingSlots: number; // spots filled by entry standard/other fixed routes
  worldRankingSlots: number; // spots filled by the ranking pool
  entryNumber: number; // total qualifying spots
  /** The fixed Birmingham qualifying window — can disagree with the athlete's live
   *  rolling ranking window, so the two "5 counting results" sets may differ. */
  firstRankingDay: string;
  lastRankingDay: string;
}

export function SimulateResult({
  gender,
  baseScores,
  currentScore,
  currentPlace,
  peerScores,
  road,
  source,
  onSourceChange,
}: {
  gender: Gender;
  baseScores: number[];
  currentScore: number;
  currentPlace: number; // current European place
  peerScores: number[]; // European peers' ranking scores (self excluded)
  road?: RoadSimData;
  source: Source;
  onSourceChange: (source: Source) => void;
}) {
  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const [mark, setMark] = useState(() => defaultHeightFor(scoringTable, gender));
  const [category, setCategory] = useState<CategoryCode>('A');
  const [place, setPlace] = useState(1);

  const effectiveMark = marks.includes(mark) ? mark : defaultHeightFor(scoringTable, gender);
  const useBirmingham = source === 'birmingham' && !!road;
  const effBaseScores = useBirmingham ? road!.baseScores : baseScores;
  const effCurrentScore = useBirmingham ? road!.currentScore : currentScore;

  const sim = useMemo(() => {
    const simScore = resultScoreFor(gender, effectiveMark, category, place);
    const { newScore, counts, dropped } = recomputeRanking(effBaseScores, simScore);
    return { simScore, newScore, counts, dropped };
  }, [gender, effectiveMark, category, place, effBaseScores]);

  const scoreD = delta(sim.newScore, effCurrentScore, false);

  const standing = useBirmingham
    ? (() => {
        const newPosition = qualifyingPosition(road!.peerScores, sim.newScore, road!.nonRankingSlots);
        const currentPosition = qualifyingPosition(
          road!.peerScores,
          effCurrentScore,
          road!.nonRankingSlots,
        );
        const qualifies = withinWorldRankingQuota(road!.peerScores, sim.newScore, road!.worldRankingSlots);
        return {
          label: 'New Birmingham position',
          value: `#${newPosition} of ${road!.entryNumber}`,
          note: qualifies ? 'Qualifying' : 'Not qualifying',
          delta: delta(newPosition, currentPosition, true),
        };
      })()
    : (() => {
        const newPlace = projectedPlace(peerScores, sim.newScore);
        return {
          label: 'New European',
          value: `#${newPlace}`,
          note: null as string | null,
          delta: delta(newPlace, currentPlace, true),
        };
      })();

  return (
    <div className="simulate">
      <div className="simulate-head">
        <div className="comps-label">Simulate a result</div>
        {road && (
          <div className="source-switch" role="tablist" aria-label="Simulation basis">
            <button
              type="button"
              role="tab"
              aria-selected={source === 'world'}
              className={source === 'world' ? 'active' : ''}
              onClick={() => onSourceChange('world')}
            >
              World ranking
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'birmingham'}
              className={source === 'birmingham' ? 'active' : ''}
              onClick={() => onSourceChange('birmingham')}
            >
              Road to Birmingham
            </button>
          </div>
        )}
      </div>
      {useBirmingham && (
        <p className="road-window-note">
          Scoped to the Birmingham qualifying window ({road!.firstRankingDay} –{' '}
          {road!.lastRankingDay}) — this can count different competitions than the live
          World/European ranking above.
        </p>
      )}
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
          <div className={`stat ${standing.delta.tone}`}>
            <div className="stat-label">{standing.label}</div>
            <div className="stat-value">{standing.value}</div>
            <div className={`stat-delta ${standing.delta.tone}`}>{standing.delta.text}</div>
            {standing.note && (
              <div className={`road-badge ${standing.note === 'Qualifying' ? 'qualified' : 'bubble'}`}>
                {standing.note}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
