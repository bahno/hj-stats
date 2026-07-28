/**
 * Capture ranking calculations for MID-TABLE and LOWER-RANKED athletes.
 *
 * Run by hand: `node scripts/capture-deep-calculations.mjs <outDir>`
 *
 * capture-oracle-fixtures.mjs only ever takes the #1 athlete of each event group, so its
 * fixtures only ever contain well-reported meetings. Two open questions need the opposite
 * sample — small meetings, thin result feeds — so this walks deeper pages of the same
 * ranking and captures the same two halves (calculation + profile results) per athlete.
 *
 * Output goes to a scratch directory, not to src/engine/__fixtures__: this is a survey of
 * a few hundred athletes, and only the cases that turn out to be evidence get promoted
 * into the committed fixture set.
 *
 * Cloudflare/TLS note and the Python workaround are documented in capture-oracle-fixtures.mjs.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EA = 'https://api.european-athletics.com/trpc';
const WA_GRAPHQL = 'https://graphql-prod-4877.edge.aws.worldathletics.org/graphql';
const WA_API_KEY = 'da2-tzmostylynabpfkrgbmmml4toq';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const OUT = process.argv[2] ?? join(tmpdir(), 'wa-deep-scan');
const groups = JSON.parse(readFileSync(new URL('../src/data/event_groups.json', import.meta.url), 'utf8')).groups;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PY_GET = `
import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={'User-Agent': sys.argv[2], 'Accept': 'application/json'})
sys.stdout.buffer.write(urllib.request.urlopen(req, timeout=60).read())
`;

function eaGet(url) {
  return execFileSync('python', ['-c', PY_GET, url, UA], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

async function trpc(proc, input) {
  const url = `${EA}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  await sleep(400);
  const body = JSON.parse(eaGet(url));
  if (body.error) throw new Error(`${proc}: ${JSON.stringify(body.error)}`);
  return body.result.data.json;
}

const RESULTS_QUERY = `query GetSingleCompetitorResultsDate($id: Int, $resultsByYear: Int, $resultsByYearOrderBy: String) {
  getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
    activeYears
    resultsByDate { date competition competitionId discipline category race place mark notLegal resultScore }
  }
}`;

async function resultsForYear(athleteId, year) {
  const res = await fetch(WA_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': WA_API_KEY },
    body: JSON.stringify({
      operationName: 'GetSingleCompetitorResultsDate',
      query: RESULTS_QUERY,
      variables: { id: athleteId, resultsByYear: year, resultsByYearOrderBy: 'date' },
    }),
  });
  const body = await res.json();
  return body?.data?.getSingleCompetitorResultsDate?.resultsByDate ?? [];
}

/** Rows sampled from one page: spread across it rather than clustered at the top. */
function sample(rows, count) {
  if (rows.length <= count) return rows;
  const step = rows.length / count;
  return Array.from({ length: count }, (_, i) => rows[Math.floor(i * step)]);
}

mkdirSync(OUT, { recursive: true });

let captured = 0;
for (const group of groups) {
  if (!group.slug) continue;
  let first;
  try {
    first = await trpc('worldAthletics.getRanking', { eventGroup: group.slug, gender: group.gender });
  } catch (err) {
    console.log(`skip ${group.label}: ${err.message}`);
    continue;
  }
  const total = first.pages ?? 1;
  // Bottom of page 1, the two pages after it, the middle page and the last page: the whole
  // depth of the ranking rather than a band of it.
  const wanted = [...new Set([1, 2, 3, Math.ceil(total / 2), total])].filter((p) => p >= 1 && p <= total);

  for (const page of wanted) {
    let rows;
    try {
      rows = page === 1
        ? first.rankings.slice(40) // page 1's top is already covered by the oracle fixtures
        : (await trpc('worldAthletics.getRanking', { eventGroup: group.slug, gender: group.gender, page })).rankings;
    } catch (err) {
      console.log(`skip ${group.label} p${page}: ${err.message}`);
      continue;
    }
    for (const row of sample(rows ?? [], 2)) {
      const name = `${group.slug}-${group.gender}-p${page}-${row.place}.json`;
      const file = join(OUT, name);
      if (existsSync(file)) { captured += 1; continue; }
      try {
        const calculation = await trpc('worldAthletics.getRankingScoreCalculation', { calculationId: row.id });
        const athleteId = Number(String(row.athleteUrlSlug).match(/-(\d+)$/)?.[1]);
        const rankYear = Number(String(first.rankDate).match(/(\d{4})/)?.[1]);
        const years = [rankYear, rankYear - 1, rankYear - 2];
        const results = (await Promise.all(years.map((y) => resultsForYear(athleteId, y)))).flat();
        writeFileSync(file, JSON.stringify({
          group: { slug: group.slug, gender: group.gender, label: group.label },
          athlete: { name: row.athlete, urlSlug: row.athleteUrlSlug, athleteId },
          place: row.place,
          rankDate: first.rankDate,
          rankingScore: row.rankingScore,
          calculation,
          results,
        }, null, 2) + '\n');
        captured += 1;
        console.log(`wrote ${name}: ${row.athlete}, ${calculation.results?.length ?? 0} counting, ${results.length} total`);
      } catch (err) {
        console.log(`skip ${name}: ${err.message}`);
      }
    }
  }
}
console.log(`captured ${captured} calculations into ${OUT}`);
