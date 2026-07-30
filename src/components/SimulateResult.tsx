import { useEffect, useMemo, useState } from 'react';
import type { CategoryCode, CountryScore, RankingType } from '../data/types';
import type { EventGroup } from '../data/events';
import { categories } from '../engine/data';
import { loadScoringTable, markNearestScore, type ParsedTable } from '../engine/scoring';
import {
  countryRank,
  projectedPlace,
  qualifyingPosition,
  recomputeRanking,
  resultScoreFor,
  withinWorldRankingQuota,
} from '../engine/simulate';
import { CategorySelect } from './inputs/CategorySelect';
import { MarkSelect } from './inputs/MarkSelect';
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
  group,
  baseScores,
  currentScore,
  currentPlace,
  peerScores,
  road,
  rankingType,
}: {
  group: EventGroup;
  baseScores: number[];
  currentScore: number;
  currentPlace: number; // current European place
  peerScores: number[]; // European peers' ranking scores (self excluded)
  road?: RoadSimData;
  rankingType: RankingType;
}) {
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mark, setMark] = useState<number | null>(null);
  const [category, setCategory] = useState<CategoryCode>('A');
  const [place, setPlace] = useState(1);

  // The scoring tables are 1.1 MB combined, so each group's chunk is fetched on demand.
  // Reload whenever the group changes, and ignore a resolve that lands after the user has
  // moved on - otherwise a slow chunk can overwrite a newer group's table.
  useEffect(() => {
    let live = true;
    setTable(null);
    setLoadFailed(false);
    setMark(null);
    loadScoringTable(group)
      .then((loaded) => {
        if (!live) return;
        setTable(loaded);
        // Open at the athlete's own level rather than a constant that only ever suited
        // the high jump.
        setMark(markNearestScore(loaded, currentScore));
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
    // currentScore seeds the opening mark; it is deliberately not a dependency, so a
    // ranking refresh does not yank the wheels back out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const useBirmingham = rankingType === 'road' && !!road;
  const effBaseScores = useBirmingham ? road!.baseScores : baseScores;
  const effCurrentScore = useBirmingham ? road!.currentScore : currentScore;

  // Null-safe so it can run above the loading guard: React forbids calling hooks
  // conditionally, so every hook in this component must sit before the early returns.
  const sim = useMemo(() => {
    if (!table || mark === null) {
      return { simScore: 0, newScore: 0, counts: false, dropped: null as number | null };
    }
    const simScore = resultScoreFor(group, table, mark, category, place);
    const { newScore, counts, dropped } = recomputeRanking(
      effBaseScores,
      simScore,
      group.countingResults,
    );
    return { simScore, newScore, counts, dropped };
  }, [group, table, mark, category, place, effBaseScores]);

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
      // Blocked by the country quota: still show a rank ignoring the cap, plus a pill
      // naming the simulated country position, instead of a blank dash.
      const displayPosition =
        newPosition ?? road.nonRankingSlots + projectedPlace(road.peers.map((p) => p.score), sim.newScore);
      const countryPill =
        newPosition == null
          ? `CP ${countryRank(road.peers, sim.newScore, road.country, road.countryPreOccupancy)}`
          : null;
      return {
        label: 'Position',
        value: `#${displayPosition}`,
        note: qualifies ? 'Qualifying' : 'Next Best',
        countryPill,
        delta:
          road.currentPosition != null
            ? delta(displayPosition, road.currentPosition, true)
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
      countryPill: null as string | null,
      delta: delta(newPlace, currentPlace, true),
    };
  }, [rankingType, road, sim.newScore, peerScores, currentPlace]);

  // Every hook above, every early return below.
  if (loadFailed) {
    return (
      <p className="comps-hint muted" data-testid="sim-load-failed">
        Couldn't load the scoring table for {group.mainEvent}.
      </p>
    );
  }
  if (!table || mark === null) {
    return <p className="comps-hint muted">Loading scoring table…</p>;
  }

  return (
    <div className="simulate">
      <div className="simulate-head">
        <div className="comps-label">Simulate a result</div>
      </div>
      <div className="fields">
        <MarkSelect table={table} value={mark} onChange={setMark} rows={3} />
        <CategorySelect categories={categories} value={category} onChange={setCategory} />
        <PositionSelect value={place} onChange={setPlace} rows={3} />
      </div>

      <div className="sim-outcome">
        <p className="sim-note">
          This result scores <strong data-testid="sim-score">{sim.simScore}</strong> (mark + placing).
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
                <div className="road-badges">
                  <div className={`road-badge ${standing.note === 'Qualifying' ? 'qualified' : 'next'}`}>
                    {standing.note}
                  </div>
                  {standing.countryPill && <div className="road-badge cp">{standing.countryPill}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
