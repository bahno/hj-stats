import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  type Gender,
  type RankingType,
  type RankingCalculation,
  type RankingRow,
  fetchHighJumpRanking,
  fetchRankingCalculation,
} from '../data/rankingApi';
import {
  countryPreOccupancy,
  fetchRoadToBirmingham,
  findQualification,
  qualifyingPoolPosition,
  qualifyingPoolPositionIgnoringQuota,
  worldRankingPoolPeers,
  type QualificationEntry,
  type RoadToBirmingham as RoadToBirminghamData,
} from '../data/birminghamApi';
import {
  athleteIdFromSlug,
  fetchAthleteHighJumpResults,
  type AthleteResult,
} from '../data/athleteResultsApi';
import {
  allCountingInWindow,
  countingKey,
  oneYearEarlier,
  parseWaDate,
  recount,
  resultKey,
  substitutePool,
  type CountingEntry,
} from '../engine/counting';
import { GenderToggle } from './inputs/GenderToggle';
import { RankingTypeToggle } from './inputs/RankingTypeToggle';
import { SimulateResult, type RoadSimData } from './SimulateResult';
import { placeClass } from './placement';
import { useFavorites } from '../hooks/FavoritesContext';
import { useAuth } from '../auth/AuthContext';
import { usePreferences } from '../hooks/usePreferences';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Every query token must appear somewhere in the athlete's name. */
function matches(query: string, athlete: string): boolean {
  const a = normalize(athlete);
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => a.includes(t));
}

/**
 * Easter egg: recognise Klára Krejčířiková however the ranking spells her.
 * Diacritics are stripped and the surname is matched loosely (starts with
 * "krej") so accent/transliteration differences from the API still trigger it.
 */
function isKlara(name: string): boolean {
  const tokens = normalize(name).split(/\s+/).filter(Boolean);
  return tokens.includes('klara') && tokens.some((t) => t.startsWith('krej'));
}

/** A little golden diadem crowned with a pink crystal, with a subtle shimmer. */
function KlaraDiadem() {
  return (
    <svg
      className="klara-diadem"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Queen"
    >
      <defs>
        <linearGradient id="klara-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e6a8" />
          <stop offset="1" stopColor="#c99a2e" />
        </linearGradient>
      </defs>
      {/* Crown: three peaks rising from a curved band. */}
      <path
        className="diadem-crown"
        d="M3 17 L6 10 L9 14 L12 7 L15 14 L18 10 L21 17 Q12 13.5 3 17 Z"
        fill="url(#klara-gold)"
        stroke="#8a6a1c"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
      {/* Pink crystal set in the centre peak. */}
      <path
        className="diadem-gem"
        d="M12 5 L13.7 8 L12 11.4 L10.3 8 Z"
        fill="var(--women)"
        stroke="#fff"
        strokeWidth="0.4"
        strokeOpacity="0.6"
      />
      {/* Twinkle over the crystal. */}
      <path
        className="diadem-spark"
        d="M12 6.4 L12.5 7.6 L13.7 8 L12.5 8.4 L12 9.6 L11.5 8.4 L10.3 8 L11.5 7.6 Z"
        fill="#fff"
      />
    </svg>
  );
}

interface Found {
  athlete: string;
  athleteUrlSlug: string;
  nationality: string;
  gender: Gender;
  /**
   * null when the athlete has no World Ranking entry at all — e.g. qualified for
   * Birmingham purely by hitting the entry standard, without the 5 counting results a
   * ranking score requires. They're still real Road to Birmingham qualifiers, just not
   * ones the ranking list can show a Score/European/World place for.
   */
  ranked: { row: RankingRow; calc: RankingCalculation; peers: RankingRow[] } | null;
  /** null when the fetch failed or hasn't been resolved — rendered as "not tracked". */
  road: RoadToBirminghamData | null;
  /** null unless the athlete is in the Birmingham world-rankings pool and the fetch succeeded. */
  roadCalc: RankingCalculation | null;
  /** The World/European ranking's publication date ("26 JUL 2026"); the end of its rolling
   *  12-month counting window. '' when the athlete has no ranking entry. */
  rankDate: string;
}

/**
 * A search match — either a ranked athlete or one found only in the Road to Birmingham
 * qualification list. Entry-standard qualifiers (and other fixed-route qualifiers) don't
 * need a World Ranking place at all, so they can be entirely absent from `fetchHighJumpRanking`
 * while still being a real, qualified-for-Birmingham hit that a search should surface.
 */
interface Hit {
  athlete: string;
  athleteUrlSlug: string;
  nationality: string;
  row: RankingRow | null;
  /** Set only when `row` is null — shown in the candidate list in place of a EU/World place. */
  qualifiedBy?: string;
}

function hitFromRow(row: RankingRow): Hit {
  return { athlete: row.athlete, athleteUrlSlug: row.athleteUrlSlug, nationality: row.nationality, row };
}

function hitFromQualification(entry: QualificationEntry): Hit {
  return {
    athlete: entry.competitor.name,
    athleteUrlSlug: entry.competitor.urlSlug,
    nationality: entry.competitor.country,
    row: null,
    qualifiedBy: entry.qualifiedBy,
  };
}

export function AthleteLookup() {
  const [gender, setGender] = useState<Gender>('men');
  const [rankingType, setRankingType] = useState<RankingType>('road')
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<Hit[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const { user } = useAuth();
  const { favorites } = useFavorites();
  // One slot for anything the star button needs to say: not signed in, at the
  // favorites cap, or a save that failed. Silently doing nothing is worse.
  const [favNotice, setFavNotice] = useState('');
  const { defaultGender } = usePreferences();
  // Every lookup takes a ticket; only the newest one is allowed to write state.
  // Without this, two quick searches race and the slower response wins, showing
  // one athlete's data under another's name.
  const requestId = useRef(0);
  useEffect(() => {
    if (defaultGender) setGender(defaultGender);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGender]);

  // Ranking lists are cached per gender so repeated searches don't refetch.
  // The TTL keeps a long-lived tab from showing last week's ranking forever.
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const [cache] = useState(
    () => new Map<Gender, { at: number; data: { rankDate: string; rows: RankingRow[] } }>(),
  );
  const [roadCache] = useState(() => new Map<Gender, { at: number; data: RoadToBirminghamData }>());

  function fresh<T>(entry: { at: number; data: T } | undefined): T | null {
    return entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.data : null;
  }

  async function ranking(g: Gender) {
    const hit = fresh(cache.get(g));
    if (hit) return hit;
    const data = await fetchHighJumpRanking(g);
    cache.set(g, { at: Date.now(), data });
    return data;
  }

  // Road to Birmingham is undocumented and can fail/change shape independently of the
  // core ranking lookup — a failure here degrades to "not tracked", never blocks select().
  async function roadToBirmingham(g: Gender): Promise<RoadToBirminghamData | null> {
    const hit = fresh(roadCache.get(g));
    if (hit) return hit;
    try {
      const data = await fetchRoadToBirmingham(g);
      roadCache.set(g, { at: Date.now(), data });
      return data;
    } catch (e) {
      console.warn('Road to Birmingham fetch failed', e);
      return null;
    }
  }

  /** Claim the newest ticket; state writes are then gated on still holding it. */
  function nextTicket(): number {
    return ++requestId.current;
  }
  function isCurrent(ticket: number): boolean {
    return requestId.current === ticket;
  }

  async function select(hit: Hit, g: Gender, ticket: number = nextTicket()) {
    setStatus('loading');
    setCandidates([]);
    setFound(null);
    try {
      if (hit.row) {
        const row = hit.row;
        const [calc, list, road] = await Promise.all([
          fetchRankingCalculation(row.id),
          ranking(g),
          roadToBirmingham(g),
        ]);
        const roadCalculationId = road
          ? findQualification(road, row.athleteUrlSlug)?.qualificationDetails.calculationId
          : undefined;
        const roadCalc =
          roadCalculationId != null
            ? await fetchRankingCalculation(roadCalculationId).catch((e) => {
                console.warn('Road to Birmingham calculation fetch failed', e);
                return null;
              })
            : null;
        if (!isCurrent(ticket)) return; // a newer lookup superseded this one
        setFound({
          athlete: row.athlete,
          athleteUrlSlug: row.athleteUrlSlug,
          nationality: row.nationality,
          gender: g,
          ranked: { row, calc, peers: list.rows },
          road,
          roadCalc,
          rankDate: list.rankDate,
        });
      } else {
        // No World Ranking entry — e.g. an entry-standard qualifier with too few counting
        // results for a ranking score. Everything we can show comes from the Road to
        // Birmingham qualification entry itself.
        const road = await roadToBirmingham(g);
        if (!isCurrent(ticket)) return;
        setFound({
          athlete: hit.athlete,
          athleteUrlSlug: hit.athleteUrlSlug,
          nationality: hit.nationality,
          gender: g,
          ranked: null,
          road,
          roadCalc: null,
          rankDate: '',
        });
      }
      setStatus('idle');
    } catch (e) {
      if (!isCurrent(ticket)) return;
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Lookup failed');
    }
  }

  async function runLookup(q: string, g: Gender, ticket: number = nextTicket()) {
    setStatus('loading');
    setMessage('');
    setFound(null);
    setCandidates([]);
    try {
      const [{ rows }, road] = await Promise.all([ranking(g), roadToBirmingham(g)]);
      const rankedHits = rows.filter((r) => matches(q, r.athlete)).map(hitFromRow);
      const rankedSlugs = new Set(rankedHits.map((h) => h.athleteUrlSlug));
      // Qualifiers with no World Ranking entry (e.g. by entry standard) are otherwise
      // invisible to search, since the ranking list used to be the only thing matched
      // against — surface them from the Road to Birmingham list too.
      const roadOnlyHits = (road?.qualifications ?? [])
        .filter((e) => !rankedSlugs.has(e.competitor.urlSlug) && matches(q, e.competitor.name))
        .map(hitFromQualification);
      const hits = [...rankedHits, ...roadOnlyHits];
      if (!isCurrent(ticket)) return; // a newer lookup superseded this one
      if (hits.length === 0) {
        setStatus('error');
        setMessage(`No ${g}'s high-jumper matching "${q}" in the current ranking or Road to Birmingham list.`);
      } else if (hits.length === 1) {
        await select(hits[0], g, ticket);
      } else {
        setCandidates(hits.slice(0, 12));
        setStatus('idle');
      }
    } catch (err) {
      if (!isCurrent(ticket)) return;
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Ranking fetch failed');
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    await runLookup(query, gender);
  }

  // Rankings are per-gender, so switching gender clears the current athlete
  // and results — otherwise a favorite's name lingers under the wrong gender.
  function changeGender(g: Gender) {
    nextTicket(); // discard anything still in flight for the old gender
    setGender(g);
    setQuery('');
    setFound(null);
    setCandidates([]);
    setStatus('idle');
    setMessage('');
  }

  function changeRankingType(r: RankingType) {
    setRankingType(r);
    setStatus('idle');
    setCandidates([]);
    setMessage('');
  }

  return (
    <section className={`card lookup ${gender}`}>
      {user && favorites.length > 0 && (
        <div className="fav-strip">
          {favorites.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`fav-chip ${f.gender}`}
              onClick={() => {
                setGender(f.gender);
                setQuery(f.athlete_name);
                void runLookup(f.athlete_name, f.gender);
              }}
            >
              ★ {f.athlete_name}
            </button>
          ))}
        </div>
      )}
      {favNotice && <p className="lookup-msg">{favNotice}</p>}
      <form className="fields" onSubmit={search}>
        <GenderToggle value={gender} onChange={changeGender} />
        <label className="field">
          <span>Athlete</span>
          <input
            className="text-input"
            type="text"
            placeholder="e.g. Tamberi"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="lookup-btn" type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Get ranking'}
        </button>
      </form>

      {status === 'error' && <p className="lookup-msg">{message}</p>}

      {candidates.length > 0 && (
        <ul className="lookup-candidates">
          {candidates.map((c) => (
            <li key={c.athleteUrlSlug}>
              <button
                type="button"
                className="lookup-candidates-element"
                onClick={() => select(c, gender)}
              >
                <span>
                  <span>{c.athlete}</span>
                  <FavoriteStar
                    slug={c.athleteUrlSlug}
                    name={c.athlete}
                    gender={gender}
                    onNotice={setFavNotice}
                  />
                </span>
                <span className="muted" style={{ marginLeft: 'auto' }}>
                  {c.row ? (
                    <>
                      {c.row.nationality} · #<span className={placeClass(c.row.place)}>{c.row.place}</span> EU · #
                      <span className={placeClass(c.row.worldPlace)}>{c.row.worldPlace}</span> World
                    </>
                  ) : (
                    <>{c.nationality} · {c.qualifiedBy ?? 'Not yet ranked'}</>
                  )}
                </span>
              </button>

            </li>
          ))}
        </ul>
      )}

      {found && <Result rankingType={rankingType} changeRankingType={changeRankingType} found={found} onNotice={setFavNotice} />}
    </section>
  );
}

function delta(current: number, previous: number | null, betterIsLower: boolean): string | null {
  if (previous == null) return null;
  const d = current - previous;
  if (d === 0) return '±0';
  const improved = betterIsLower ? d < 0 : d > 0;
  return `${improved ? '▲' : '▼'} ${Math.abs(d)}`;
}

/**
 * The Road to # stat card's value/badges for the three possible states. When qualified,
 * the API's own `qualificationPosition` is authoritative. When not yet qualified, the API
 * gives no position at all — `qualificationDetails.place` is the athlete's raw World
 * Ranking place (unrelated to the qualifying pool), not their standing in the qualifying
 * order, so `qualifyingPoolPosition` computes it from the pool's own ordering instead.
 *
 * When blocked by the country quota specifically (`qualifyingPoolPosition` returns
 * `null` for a real pool entry), still show a rank — `qualifyingPoolPositionIgnoringQuota`
 * ignores the cap entirely — alongside a `countryPill` naming the athlete's actual
 * position within their own country (from the API's `countryPosition`), so the block
 * reads as "4th in your country, cap is 3" rather than a blank dash.
 */
function roadToStat(
  road: RoadToBirminghamData | null,
  entry: QualificationEntry | undefined,
): { value: string; label: string; pill: 'qualified' | 'next' | null; countryPill: string | null } {
  if (!road || !entry) return { value: '—', label: 'Not tracked', pill: null, countryPill: null };
  if (entry.qualified) {
    const pos = entry.qualificationPosition;
    return { value: pos != null ? `#${pos}` : '—', label: 'Qualifying', pill: 'qualified', countryPill: null };
  }
  const pos = qualifyingPoolPosition(road, entry.competitor.urlSlug);
  if (pos != null) {
    return { value: `#${pos}`, label: 'Next Best', pill: 'next', countryPill: null };
  }
  const uncapped = qualifyingPoolPositionIgnoringQuota(road, entry.competitor.urlSlug);
  return {
    value: uncapped != null ? `#${uncapped}` : '—',
    label: 'Next Best',
    pill: 'next',
    countryPill: entry.countryPosition != null ? `CP ${entry.countryPosition}` : null,
  };
}

/**
 * An athlete's current qualifying-pool position, whichever state they're in — the API's
 * own value when qualified, our computed one when not, and the uncapped-ignoring-quota
 * one (same fallback `roadToStat` displays) when blocked by the country quota, so the
 * simulate tile always has a real baseline to diff a simulated result against instead of
 * showing a blank delta. `null` only when untracked or not in the pool at all.
 */
function currentRoadPosition(
  road: RoadToBirminghamData | null,
  entry: QualificationEntry | undefined,
): number | null {
  if (!road || !entry) return null;
  if (entry.qualified) return entry.qualificationPosition;
  const pos = qualifyingPoolPosition(road, entry.competitor.urlSlug);
  return pos ?? qualifyingPoolPositionIgnoringQuota(road, entry.competitor.urlSlug);
}

/** The calendar years an inclusive [startMs, endMs] window touches — the set to fetch. */
function yearsInRange(startMs: number, endMs: number): number[] {
  const from = new Date(startMs).getUTCFullYear();
  const to = new Date(endMs).getUTCFullYear();
  const years: number[] = [];
  for (let y = from; y <= to; y++) years.push(y);
  return years;
}

type ResultsState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Lazily loads an athlete's full High Jump result list from WorldAthletics (see
 * athleteResultsApi.ts) once we have a window to fetch. Powers the "remove a counting
 * competition and slot in the next best" feature; on any failure it stays in `error` and
 * the feature simply doesn't offer removal, never blocking the core lookup.
 */
function useAthleteResults(slug: string, years: number[], enabled: boolean) {
  const [results, setResults] = useState<AthleteResult[] | null>(null);
  const [state, setState] = useState<ResultsState>('idle');
  // Stable dependency so we refetch only when the athlete or the fetched years change.
  const yearsKey = years.join(',');
  useEffect(() => {
    setResults(null);
    if (!enabled || years.length === 0) {
      setState('idle');
      return;
    }
    const id = athleteIdFromSlug(slug);
    if (id == null) {
      setState('error');
      return;
    }
    let cancelled = false;
    setState('loading');
    fetchAthleteHighJumpResults(id, years)
      .then((rs) => {
        if (cancelled) return;
        setResults(rs);
        setState('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('Athlete results fetch failed', e);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, yearsKey, enabled]);
  return { results, state };
}

function Result({ found, onNotice, rankingType, changeRankingType }: { found: Found; onNotice: (msg: string) => void, rankingType: RankingType, changeRankingType: (r: RankingType) => void }) {
  const { athlete, athleteUrlSlug, nationality, gender, ranked, road, roadCalc } = found;
  const results = ranked?.calc.results ?? [];
  const baseScores = results.map((r) => r.performanceScore);
  const peerScores = ranked ? ranked.peers.filter((p) => p.id !== ranked.row.id).map((p) => p.rankingScore) : [];
  const placeDelta = ranked ? delta(ranked.row.place, ranked.row.previousPlace, true) : null;
  const scoreDelta = ranked ? delta(ranked.row.rankingScore, ranked.row.previousRankingScore, false) : null;

  const roadEntry = road ? findQualification(road, athleteUrlSlug) : undefined;
  const roadStat = roadToStat(road, roadEntry);
  const displayedResults = rankingType === 'road' && roadCalc ? roadCalc.results : results;
  const roadSim: RoadSimData | undefined =
    ranked && road && roadCalc
      ? {
          baseScores: roadCalc.results.map((r) => r.performanceScore),
          currentScore: roadCalc.averagePerformanceScore,
          peers: worldRankingPoolPeers(road, athleteUrlSlug),
          country: nationality,
          countryPreOccupancy: countryPreOccupancy(road),
          currentPosition: currentRoadPosition(road, roadEntry),
          nonRankingSlots: road.entryNumber - road.numberOfCompetitorsFilledUpByWorldRankings,
          worldRankingSlots: road.numberOfCompetitorsFilledUpByWorldRankings,
          entryNumber: road.entryNumber,
          firstRankingDay: road.firstRankingDay,
          lastRankingDay: road.lastRankingDay,
        }
      : undefined;

  // --- Temporarily remove a counting competition and slot in the next best ---------------
  // The counting window for the currently-selected ranking: a rolling 12 months ending at
  // the rank date for World/European, or Birmingham's fixed first/last ranking day for Road.
  const onRoad = rankingType === 'road' && !!roadCalc && !!road;
  const activeWindow = useMemo(() => {
    if (onRoad && road) {
      return { start: parseWaDate(road.firstRankingDay), end: parseWaDate(road.lastRankingDay) };
    }
    const end = parseWaDate(found.rankDate);
    return { start: oneYearEarlier(end), end };
  }, [onRoad, road, found.rankDate]);

  // Fetch every year any of the athlete's windows might touch (so switching ranking type
  // never needs a refetch), but only when we actually have a ranking to reconstruct.
  const fetchYears = useMemo(() => {
    const bounds = [activeWindow.start, activeWindow.end];
    if (road) bounds.push(parseWaDate(road.firstRankingDay), parseWaDate(road.lastRankingDay));
    if (found.rankDate) {
      const end = parseWaDate(found.rankDate);
      bounds.push(oneYearEarlier(end), end);
    }
    const valid = bounds.filter(Number.isFinite);
    return valid.length ? yearsInRange(Math.min(...valid), Math.max(...valid)) : [];
  }, [activeWindow, road, found.rankDate]);

  const { results: allResults, state: resultsState } = useAthleteResults(
    athleteUrlSlug,
    fetchYears,
    !!ranked,
  );

  // The official counting set (from WA's calc) is trusted as-is; we only derive the "next
  // best" substitutes. `cap` is the lowest counting score — a real 6th never out-scores the 5.
  const windowValid = Number.isFinite(activeWindow.start) && Number.isFinite(activeWindow.end);
  const countingEntries: CountingEntry[] = useMemo(
    () => displayedResults.map((r) => ({ key: resultKey(r), score: r.performanceScore })),
    [displayedResults],
  );
  const cap = countingEntries.length ? Math.min(...countingEntries.map((c) => c.score)) : 0;

  const subs = useMemo(() => {
    if (!allResults || !windowValid) return [];
    // Exclude the counting results by a place-independent key (a qual's place drifts between
    // the calc and profile feeds), so an already-counting result can't reappear as a substitute.
    const keys = new Set(displayedResults.map(countingKey));
    return substitutePool(allResults, activeWindow.start, activeWindow.end, keys, cap);
  }, [allResults, windowValid, activeWindow, displayedResults, cap]);

  // Offer replacement only when the window is sound: valid bounds and every official counting
  // result sits inside it (a wrong rank date would put one outside and make the 6th unreliable).
  const canReplace =
    !!allResults && windowValid && allCountingInWindow(displayedResults, activeWindow.start, activeWindow.end);

  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // A removal only makes sense against the current athlete + ranking window; reset otherwise.
  useEffect(() => {
    setRemoved(new Set());
  }, [athleteUrlSlug, rankingType]);

  const recomputed = canReplace && removed.size > 0 ? recount(countingEntries, removed, subs) : null;
  const substitutes = recomputed ? recomputed.substitutesUsed : [];

  const currentSelectedScore = onRoad && roadCalc ? roadCalc.averagePerformanceScore : ranked?.row.rankingScore ?? 0;
  const adjustedDelta = recomputed ? recomputed.average - currentSelectedScore : 0;

  function toggleRemoved(key: string) {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Feed the adjusted counting set into the simulator so a simulated result builds on the
  // post-removal five, per ranking type (removals only ever exist for the active one).
  const simBaseScores = recomputed && !onRoad ? recomputed.baseScores : baseScores;
  const simCurrentScore = recomputed && !onRoad ? recomputed.average : ranked?.row.rankingScore ?? 0;
  const simRoad =
    recomputed && onRoad && roadSim
      ? { ...roadSim, baseScores: recomputed.baseScores, currentScore: recomputed.average }
      : roadSim;

  return (
    <div className="lookup-result">
      <div className="lookup-head">
        <div className="lookup-name-row">
          <div className="lookup-name">
            {athlete}
            {isKlara(athlete) && <KlaraDiadem />}
          </div>
          <FavoriteStar
            slug={athleteUrlSlug}
            name={athlete}
            gender={gender}
            onNotice={onNotice}
          />
        </div>
        <div className="muted">{nationality} · High Jump</div>
      </div>

      <div className="lookup-stats">
        {ranked ? (
          <>
            <div className="stat">
              <div className="stat-label">Score</div>
              <div className="stat-value">{ranked.row.rankingScore}</div>
              {scoreDelta && <div className="stat-delta">{scoreDelta} vs last week</div>}
            </div>
            <div className="stat">
              <div className="stat-label">European</div>
              <div className={`stat-value ${placeClass(ranked.row.place) ?? ''}`}>#{ranked.row.place}</div>
              {placeDelta && <div className="stat-delta">{placeDelta}</div>}
            </div>
            <div className="stat">
              <div className="stat-label">World</div>
              <div className={`stat-value ${placeClass(ranked.row.worldPlace) ?? ''}`}>#{ranked.row.worldPlace}</div>
            </div>
          </>
        ) : (
          <div className="stat">
            <div className="stat-label">World Ranking</div>
            <div className="stat-value">—</div>
            <div className="stat-delta">Not enough results to be ranked</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Road To</div>
          <div className="stat-value">{roadStat.value}</div>
          {roadStat.pill ? (
            <div className="road-badges">
              <div className={`road-badge ${roadStat.pill}`}>{roadStat.label}</div>
              {roadStat.countryPill && <div className="road-badge cp">{roadStat.countryPill}</div>}
            </div>
          ) : (
            <div className="stat-delta">{roadStat.label}</div>
          )}
        </div>
      </div>

      <div className="section-divider" />

      {ranked ? (
        <>
          <div className="lookup-toggle-row">
            <RankingTypeToggle value={rankingType} gender={gender} onChange={changeRankingType} />
          </div>

          <div className="lookup-comps">
            {recomputed && (
              <div className="recount-summary" data-testid="recount-summary">
                <span className="recount-label">Adjusted ranking</span>
                <span className="recount-value">{recomputed.average}</span>
                <span className={`recount-delta ${adjustedDelta === 0 ? 'flat' : adjustedDelta > 0 ? 'up' : 'down'}`}>
                  {adjustedDelta === 0 ? '±0' : `${adjustedDelta > 0 ? '▲' : '▼'} ${Math.abs(adjustedDelta)}`}
                </span>
                <button type="button" className="recount-reset" onClick={() => setRemoved(new Set())}>
                  Reset
                </button>
              </div>
            )}
            <ul className="comp-list">
              {displayedResults.map((r, i) => {
                const key = resultKey(r);
                const isRemoved = removed.has(key);
                return (
                  <li className={`comp-item ${isRemoved ? 'removed' : ''}`} key={`${r.date}-${i}`}>
                    <div className="comp-main">
                      <div className="comp-name">{r.competition}</div>
                      <div className="comp-meta">
                        <span className="cat-badge">{r.category}</span>
                        {r.date} · <span className={placeClass(r.place)}>{r.place}</span> · {r.mark} m
                      </div>
                    </div>
                    <div className="comp-score">
                      <span className="score-total">{r.performanceScore}</span>
                      <span className="score-parts">
                        {r.resultScore}+{r.placingScore}
                      </span>
                    </div>
                    {canReplace && (
                      <button
                        type="button"
                        className={`comp-remove ${isRemoved ? 'on' : ''}`}
                        aria-pressed={isRemoved}
                        aria-label={isRemoved ? 'Restore this competition' : 'Remove this competition'}
                        title={isRemoved ? 'Restore this competition' : 'Remove (expired) — recalculate with the next best result'}
                        onClick={() => toggleRemoved(key)}
                      >
                        {isRemoved ? '↺' : '✕'}
                      </button>
                    )}
                  </li>
                );
              })}
              {substitutes.map((r) => (
                <li className="comp-item substitute" key={`sub-${resultKey(r)}`}>
                  <div className="comp-main">
                    <div className="comp-name">
                      {r.competition}
                      <span className="sub-badge">Next best</span>
                    </div>
                    <div className="comp-meta">
                      <span className="cat-badge">{r.category}</span>
                      {r.race !== 'F' && <span className="qual-badge" title="Qualification round">Q</span>}
                      {r.date} · <span className={placeClass(r.place)}>{r.place}</span> · {r.mark} m
                    </div>
                  </div>
                  <div className="comp-score">
                    <span className="score-total">{r.score}</span>
                    <span className="score-parts">
                      {r.resultScore}+{r.score - r.resultScore}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {resultsState === 'loading' && (
              <p className="comps-hint muted">Loading full results…</p>
            )}
            {resultsState === 'ready' && !canReplace && (
              <p className="comps-hint muted">Result replacement unavailable for this athlete.</p>
            )}
          </div>

          <SimulateResult
            gender={gender}
            baseScores={simBaseScores}
            currentScore={simCurrentScore}
            currentPlace={ranked.row.place}
            peerScores={peerScores}
            road={simRoad}
            rankingType={rankingType}
          />
        </>
      ) : (
        roadEntry?.qualificationDetails && (
          <div className="lookup-comps">
            <ul className="comp-list">
              <li className="comp-item">
                <div className="comp-main">
                  <div className="comp-name">{roadEntry.qualifiedBy}</div>
                  <div className="comp-meta">
                    {roadEntry.qualificationDetails.venue}
                    {roadEntry.qualificationDetails.date && <> · {roadEntry.qualificationDetails.date}</>}
                    {roadEntry.qualificationDetails.result && <> · {roadEntry.qualificationDetails.result} m</>}
                  </div>
                </div>
              </li>
            </ul>
          </div>
        )
      )}
    </div>
  );
}

/**
 * Turn a favorites write failure into something worth reading. The 50-favorite
 * cap is enforced by a database trigger, so it surfaces as a Postgres error
 * rather than anything the client can pre-check.
 */
function favoriteError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('favorite limit reached')) {
    return "You've reached the 50-favorite limit. Un-star someone to add another.";
  }
  return "Couldn't save that favorite. Please try again.";
}

function FavoriteStar({
  slug,
  name,
  gender,
  onNotice,
}: {
  slug: string;
  name: string;
  gender: Gender;
  onNotice: (msg: string) => void;
}) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(slug, gender);
  return (
    <button
      type="button"
      className={`fav-star ${active ? 'on' : ''}`}
      aria-pressed={active}
      aria-label={active ? 'Remove favorite' : 'Add favorite'}
      onClick={(event) => {
        event.stopPropagation();
        if (!user) return onNotice('Sign in to save favorites.');
        onNotice('');
        void toggle({ athlete_slug: slug, athlete_name: name, gender }).catch((e) =>
          onNotice(favoriteError(e)),
        );
      }}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
