import { useState, type FormEvent } from 'react';
import {
  type Gender,
  type RankingCalculation,
  type RankingRow,
  fetchHighJumpRanking,
  fetchRankingCalculation,
} from '../data/rankingApi';
import { GenderToggle } from './inputs/GenderToggle';
import { SimulateResult } from './SimulateResult';
import { placeClass } from './placement';

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

interface Found {
  row: RankingRow;
  calc: RankingCalculation;
  peers: RankingRow[];
  gender: Gender;
}

export function AthleteLookup() {
  const [gender, setGender] = useState<Gender>('men');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<RankingRow[]>([]);
  const [found, setFound] = useState<Found | null>(null);

  // Ranking lists are cached per gender so repeated searches don't refetch.
  const [cache] = useState(() => new Map<Gender, { rankDate: string; rows: RankingRow[] }>());

  async function ranking(g: Gender) {
    const hit = cache.get(g);
    if (hit) return hit;
    const data = await fetchHighJumpRanking(g);
    cache.set(g, data);
    return data;
  }

  async function select(row: RankingRow) {
    setStatus('loading');
    setCandidates([]);
    setFound(null);
    try {
      const [calc, list] = await Promise.all([
        fetchRankingCalculation(row.id),
        ranking(gender),
      ]);
      setFound({ row, calc, peers: list.rows, gender });
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Lookup failed');
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus('loading');
    setMessage('');
    setFound(null);
    setCandidates([]);
    try {
      const { rows } = await ranking(gender);
      const hits = rows.filter((r) => matches(query, r.athlete));
      if (hits.length === 0) {
        setStatus('error');
        setMessage(`No ${gender}'s high-jumper matching "${query}" in the current ranking.`);
      } else if (hits.length === 1) {
        await select(hits[0]);
      } else {
        setCandidates(hits.slice(0, 12));
        setStatus('idle');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Ranking fetch failed');
    }
  }

  return (
    <section className={`card lookup ${gender}`}>
      <form className="fields" onSubmit={search}>
        <GenderToggle value={gender} onChange={setGender} />
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
              <button type="button" onClick={() => select(c)}>
                <span>{c.athlete}</span>
                <span className="muted">
                  {c.nationality} · #<span className={placeClass(c.place)}>{c.place}</span> EU
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {found && <Result found={found} />}
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

function Result({ found }: { found: Found }) {
  const { row, calc, peers, gender } = found;
  const results = calc.results;
  const baseScores = results.map((r) => r.performanceScore);
  const peerScores = peers.filter((p) => p.id !== row.id).map((p) => p.rankingScore);
  const placeDelta = delta(row.place, row.previousPlace, true);
  const scoreDelta = delta(row.rankingScore, row.previousRankingScore, false);

  return (
    <div className="lookup-result">
      <div className="lookup-head">
        <div className="lookup-name">{row.athlete}</div>
        <div className="muted">{row.nationality} · High Jump</div>
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
      />
    </div>
  );
}
