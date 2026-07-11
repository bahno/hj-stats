import { useEffect, useState, type FormEvent } from 'react';
import {
  type Gender,
  type RankingCalculation,
  type RankingRow,
  fetchHighJumpRanking,
  fetchRankingCalculation,
} from '../data/rankingApi';
import {
  fetchRoadToBirmingham,
  findQualification,
  worldRankingPoolPeerScores,
  type QualificationEntry,
  type RoadToBirmingham as RoadToBirminghamData,
} from '../data/birminghamApi';
import { GenderToggle } from './inputs/GenderToggle';
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
  row: RankingRow;
  calc: RankingCalculation;
  peers: RankingRow[];
  gender: Gender;
  /** null when the fetch failed or hasn't been resolved — rendered as "not tracked". */
  road: RoadToBirminghamData | null;
  /** null unless the athlete is in the Birmingham world-rankings pool and the fetch succeeded. */
  roadCalc: RankingCalculation | null;
}

export function AthleteLookup() {
  const [gender, setGender] = useState<Gender>('men');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<RankingRow[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const { user } = useAuth();
  const { favorites } = useFavorites();
  const [needSignIn, setNeedSignIn] = useState(false);
  const { defaultGender } = usePreferences();
  useEffect(() => {
    if (defaultGender) setGender(defaultGender);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGender]);

  // Ranking lists are cached per gender so repeated searches don't refetch.
  const [cache] = useState(() => new Map<Gender, { rankDate: string; rows: RankingRow[] }>());
  const [roadCache] = useState(() => new Map<Gender, RoadToBirminghamData>());

  async function ranking(g: Gender) {
    const hit = cache.get(g);
    if (hit) return hit;
    const data = await fetchHighJumpRanking(g);
    cache.set(g, data);
    return data;
  }

  // Road to Birmingham is undocumented and can fail/change shape independently of the
  // core ranking lookup — a failure here degrades to "not tracked", never blocks select().
  async function roadToBirmingham(g: Gender): Promise<RoadToBirminghamData | null> {
    const hit = roadCache.get(g);
    if (hit) return hit;
    try {
      const data = await fetchRoadToBirmingham(g);
      roadCache.set(g, data);
      return data;
    } catch (e) {
      console.warn('Road to Birmingham fetch failed', e);
      return null;
    }
  }

  async function select(row: RankingRow, g: Gender) {
    setStatus('loading');
    setCandidates([]);
    setFound(null);
    try {
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
      setFound({ row, calc, peers: list.rows, gender: g, road, roadCalc });
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Lookup failed');
    }
  }

  async function runLookup(q: string, g: Gender) {
    setStatus('loading');
    setMessage('');
    setFound(null);
    setCandidates([]);
    try {
      const { rows } = await ranking(g);
      const hits = rows.filter((r) => matches(q, r.athlete));
      if (hits.length === 0) {
        setStatus('error');
        setMessage(`No ${g}'s high-jumper matching "${q}" in the current ranking.`);
      } else if (hits.length === 1) {
        await select(hits[0], g);
      } else {
        setCandidates(hits.slice(0, 12));
        setStatus('idle');
      }
    } catch (err) {
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
    setGender(g);
    setQuery('');
    setFound(null);
    setCandidates([]);
    setStatus('idle');
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
      {needSignIn && (
        <p className="lookup-msg">Sign in to save favorites.</p>
      )}
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
            <li key={c.id}>
              <button type="button" onClick={() => select(c, gender)}>
                <span>{c.athlete}</span>
                <span className="muted">
                  {c.nationality} · #<span className={placeClass(c.place)}>{c.place}</span> EU
                </span>
              </button>
              <FavoriteStar
                slug={c.athleteUrlSlug}
                name={c.athlete}
                gender={gender}
                onNeedSignIn={() => setNeedSignIn(true)}
              />
            </li>
          ))}
        </ul>
      )}

      {found && <Result found={found} onNeedSignIn={() => setNeedSignIn(true)} />}
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

function Result({ found, onNeedSignIn }: { found: Found; onNeedSignIn: () => void }) {
  const { row, calc, peers, gender, road, roadCalc } = found;
  const results = calc.results;
  const baseScores = results.map((r) => r.performanceScore);
  const peerScores = peers.filter((p) => p.id !== row.id).map((p) => p.rankingScore);
  const placeDelta = delta(row.place, row.previousPlace, true);
  const scoreDelta = delta(row.rankingScore, row.previousRankingScore, false);

  const roadEntry = road ? findQualification(road, row.athleteUrlSlug) : undefined;
  const roadSim: RoadSimData | undefined =
    road && roadCalc
      ? {
          baseScores: roadCalc.results.map((r) => r.performanceScore),
          currentScore: roadCalc.averagePerformanceScore,
          peerScores: worldRankingPoolPeerScores(road, row.athleteUrlSlug),
          nonRankingSlots: road.entryNumber - road.numberOfCompetitorsFilledUpByWorldRankings,
          worldRankingSlots: road.numberOfCompetitorsFilledUpByWorldRankings,
          entryNumber: road.entryNumber,
        }
      : undefined;

  return (
    <div className="lookup-result">
      <div className="lookup-head">
        <div className="lookup-name">
          {row.athlete}
          {isKlara(row.athlete) && <KlaraDiadem />}
        </div>
        <div className="muted">{row.nationality} · High Jump</div>
        <FavoriteStar
          slug={row.athleteUrlSlug}
          name={row.athlete}
          gender={gender}
          onNeedSignIn={onNeedSignIn}
        />
      </div>

      <div className="lookup-stats">
        <div className="stat">
          <div className="stat-label">Ranking score</div>
          <div className="stat-value">{row.rankingScore}</div>
          {scoreDelta && <div className="stat-delta">{scoreDelta} vs last week</div>}
        </div>
        <div className="stat">
          <div className="stat-label">European</div>
          <div className={`stat-value ${placeClass(row.place) ?? ''}`}>#{row.place}</div>
          {placeDelta && <div className="stat-delta">{placeDelta}</div>}
        </div>
        <div className="stat">
          <div className="stat-label">World</div>
          <div className={`stat-value ${placeClass(row.worldPlace) ?? ''}`}>#{row.worldPlace}</div>
        </div>
      </div>

      <RoadToBirmingham entry={roadEntry} entryNumber={road?.entryNumber} />

      <div className="lookup-comps">
        <ul className="comp-list">
          {results.map((r, i) => (
            <li className="comp-item" key={`${r.date}-${i}`}>
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
            </li>
          ))}
        </ul>
      </div>

      <SimulateResult
        gender={gender}
        baseScores={baseScores}
        currentScore={row.rankingScore}
        currentPlace={row.place}
        peerScores={peerScores}
        road={roadSim}
      />
    </div>
  );
}

/** Human-readable qualification detail for a Road to Birmingham entry. */
function qualificationDetail(entry: QualificationEntry): string {
  const { label, result, venue, date, place, score } = entry.qualificationDetails;
  if (label) return label;
  if (result) return [`${result} m`, venue, date].filter(Boolean).join(' · ');
  if (score != null) return `World ranking #${place} · ${score} pts`;
  return entry.qualifiedBy;
}

function RoadToBirmingham({
  entry,
  entryNumber,
}: {
  entry: QualificationEntry | undefined;
  entryNumber: number | undefined;
}) {
  if (!entry) {
    return (
      <div className="road-to-birmingham">
        <div className="road-label">Road to Birmingham</div>
        <div className="muted">Not currently on the Road to Birmingham list.</div>
      </div>
    );
  }

  return (
    <div className="road-to-birmingham">
      <div className="road-label">Road to Birmingham</div>
      <div className="road-row">
        <span className={`road-badge ${entry.qualified ? 'qualified' : 'bubble'}`}>
          {entry.qualified ? 'Qualified' : 'Not yet qualifying'}
        </span>
        <span className="road-detail">{qualificationDetail(entry)}</span>
      </div>
      {entry.qualified && entry.qualificationPosition != null && (
        <div className="muted road-position">
          #{entry.qualificationPosition} of {entryNumber} qualifying spots
        </div>
      )}
    </div>
  );
}

function FavoriteStar({
  slug,
  name,
  gender,
  onNeedSignIn,
}: {
  slug: string;
  name: string;
  gender: Gender;
  onNeedSignIn: () => void;
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
      onClick={() => {
        if (!user) return onNeedSignIn();
        void toggle({ athlete_slug: slug, athlete_name: name, gender }).catch(() => {});
      }}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
