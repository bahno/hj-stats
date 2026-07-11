import { useMemo, useState } from 'react';
import type { CategoryCode, CountryScore, Gender, RankingType } from '../data/types';
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
  peers: CountryScore[]; // world-rankings-pool peers' scores + countries (self excluded)
  country: string; // the athlete's own country, for the per-country quota
  /** Per-country counts of qualifiers already locked in outside the pool (entry standard,
   *  etc.) — these consume a share of the 3-per-country cap too, see
   *  birminghamApi.countryPreOccupancy. */
  countryPreOccupancy: Record<string, number>;
  /** The athlete's actual current position (API value when qualified, else computed from
   *  the pool's own order — see birminghamApi.qualifyingPoolPosition), or null if
   *  untracked. Used as the baseline for the delta against a simulated new position;
   *  computed from the real recorded score, so ties against real peers resolve the same
   *  way the official pool order does, unlike the simulated position below. */
  currentPosition: number | null;
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
  rankingType,
}: {
  gender: Gender;
  baseScores: number[];
  currentScore: number;
  currentPlace: number; // current European place
  peerScores: number[]; // European peers' ranking scores (self excluded)
  road?: RoadSimData;
  rankingType: RankingType;
}) {
  const marks = useMemo(() => availableMarks(scoringTable, gender), [gender]);
  const [mark, setMark] = useState(() => defaultHeightFor(scoringTable, gender));
  const [category, setCategory] = useState<CategoryCode>('A');
  const [place, setPlace] = useState(1);

  const effectiveMark = marks.includes(mark) ? mark : defaultHeightFor(scoringTable, gender);
  const useBirmingham = rankingType === 'road' && !!road;
  const effBaseScores = useBirmingham ? road!.baseScores : baseScores;
  const effCurrentScore = useBirmingham ? road!.currentScore : currentScore;

  const sim = useMemo(() => {
    const simScore = resultScoreFor(gender, effectiveMark, category, place);
    const { newScore, counts, dropped } = recomputeRanking(effBaseScores, simScore);
    return { simScore, newScore, counts, dropped };
  }, [gender, effectiveMark, category, place, effBaseScores]);

  const scoreD = delta(sim.newScore, effCurrentScore, false);

  const standing = useMemo(() => {
    if (rankingType === 'road' && road) {
      const newPosition = qualifyingPosition(
        road.peers,
        sim.newScore,
        road.country,
        road.nonRankingSlots,
        road.countryPreOccupancy,
      );
      const qualifies = withinWorldRankingQuota(
        road.peers,
        sim.newScore,
        road.country,
        road.worldRankingSlots,
        road.countryPreOccupancy,
      );
      return {
        label: 'Position',
        value: newPosition != null ? `#${newPosition}` : '—',
        note: newPosition == null ? 'Blocked by country quota' : qualifies ? 'Qualifying' : 'Next Best',
        delta:
          newPosition != null && road.currentPosition != null
            ? delta(newPosition, road.currentPosition, true)
            : { text: '—', tone: 'flat' as Tone },
      };
    }
    if (rankingType === 'world') return null;
    // 'european', or 'road' selected but the athlete has no world-rankings-pool data
    // (e.g. qualified by entry standard) — fall back to the European projection rather
    // than showing nothing.
    const newPlace = projectedPlace(peerScores, sim.newScore);
    return {
      label: 'Position',
      value: `#${newPlace}`,
      note: null as string | null,
      delta: delta(newPlace, currentPlace, true),
    };
  }, [rankingType, road, sim.newScore, peerScores, currentPlace]);

  return (
    <div className="simulate">
      <div className="simulate-head">
        <div className="comps-label">Simulate a result</div>
      </div>
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

        <div className={`lookup-stats small ${standing ? '' : 'single'}`}>
          <div className={`stat ${scoreD.tone}`}>
            <div className="stat-label">Ranking</div>
            <div className="stat-value">{sim.newScore}</div>
            <div className={`stat-delta ${scoreD.tone}`}>{scoreD.text}</div>
          </div>
          {standing && (
            <div className={`stat ${standing.delta.tone}`}>
              <div className="stat-label">{standing.label}</div>
              <div className="stat-value">{standing.value}</div>
              <div className={`stat-delta ${standing.delta.tone}`}>{standing.delta.text}</div>
              {standing.note && (
                <div className={`road-badge ${standing.note === 'Qualifying' ? 'qualified' : 'next'}`}>
                  {standing.note}
                </div>
              )}
            </div>
          )}
        </div>

        {!standing && (
          <p className="road-window-note">
            Projected position isn't available for World ranking — only European peer data is known.
          </p>
        )}
      </div>
    </div>
  );
}
