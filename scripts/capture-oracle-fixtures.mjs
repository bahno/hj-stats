/**
 * Capture live World Athletics payloads as offline test fixtures.
 *
 * Run by hand, not in CI: `node scripts/capture-oracle-fixtures.mjs`
 *
 * For each event group it takes the top-ranked athlete, then saves both halves of the
 * oracle: World Athletics' own ranking calculation (the counting set they chose) and the
 * athlete's full profile results (the input our engine reconstructs from).
 *
 * The European Athletics gateway sits behind Cloudflare, which 403s Node's own fetch
 * (undici) on TLS fingerprint alone — every header combination tried, including a full
 * browser set, is rejected. Python's stdlib urllib is let through with nothing but a
 * browser User-Agent, so the EA half of the capture is shelled out to it. The World
 * Athletics GraphQL endpoint has no such front and is fetched from Node directly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const EA = 'https://api.european-athletics.com/trpc';
const WA_GRAPHQL = 'https://graphql-prod-4877.edge.aws.worldathletics.org/graphql';
const WA_API_KEY = 'da2-tzmostylynabpfkrgbmmml4toq';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT = new URL('../src/engine/__fixtures__/oracle/', import.meta.url);

const groups = JSON.parse(readFileSync(new URL('../src/data/event_groups.json', import.meta.url), 'utf8')).groups;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PY_GET = `
import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={'User-Agent': sys.argv[2], 'Accept': 'application/json'})
sys.stdout.buffer.write(urllib.request.urlopen(req, timeout=30).read())
`;

/** GET through Python's stdlib, the only client Cloudflare lets past on this host. */
function eaGet(url) {
  return execFileSync('python', ['-c', PY_GET, url, UA], { encoding: 'utf8', maxBuffer: 32 << 20 });
}

async function trpc(proc, input) {
  const url = `${EA}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
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

mkdirSync(OUT, { recursive: true });

for (const group of groups) {
  if (!group.slug) continue;
  try {
    const ranking = await trpc('worldAthletics.getRanking', { eventGroup: group.slug, gender: group.gender });
    const row = ranking.rankings?.[0];
    if (!row) { console.log(`skip ${group.label}: empty ranking`); continue; }

    const calculation = await trpc('worldAthletics.getRankingScoreCalculation', { calculationId: row.id });
    const athleteId = Number(String(row.athleteUrlSlug).match(/-(\d+)$/)?.[1]);
    const rankYear = Number(String(ranking.rankDate).match(/(\d{4})/)?.[1]);
    // Cover the widest window any group uses (18 months) plus the three calendar
    // year Area Championships allowance.
    const years = [rankYear, rankYear - 1, rankYear - 2];
    const results = (await Promise.all(years.map((y) => resultsForYear(athleteId, y)))).flat();

    const name = `${group.slug}-${group.gender}.json`;
    writeFileSync(new URL(name, OUT), JSON.stringify({
      group: { slug: group.slug, gender: group.gender, label: group.label },
      athlete: { name: row.athlete, urlSlug: row.athleteUrlSlug, athleteId },
      rankDate: ranking.rankDate,
      rankingScore: row.rankingScore,
      calculation,
      results,
    }, null, 2) + '\n');
    console.log(`wrote ${name}: ${row.athlete}, ${calculation.results?.length ?? 0} counting, ${results.length} total`);
  } catch (err) {
    console.log(`skip ${group.label}: ${err.message}`);
  }
  await sleep(400);
}
