// Paikalliset testit: node test/test.mjs
// Ei verkkoa - globalThis.fetch korvataan mockilla. Sisaiset funktiot
// saadaan esiin kirjoittamalla lahdekoodista valiaikainen kopio, jonka
// loppuun lisataan export-rivi.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'amoc-'));
const tmp = join(dir, 'index.mjs');
writeFileSync(tmp, src + '\nexport { pValueFromR, tTwoSidedP, benjaminiHochberg, effectiveN, splitDateRangeIntoChunks };\n');
const m = await import(pathToFileURL(tmp).href);
const worker = m.default;

let pass = 0, fail = 0;
function ok(name, cond, extra = '') { if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1) t-jakauman p-arvot: vertailuarvot scipy.stats.t.sf(t, df)*2
// (laskettu 5.10.2026, scipy 1.x)
const ref = [
  [0.525, 24.2, 0.0081], [0.525, 32.3, 0.0019], [0.392, 32.3, 0.0257],
  [0.359, 24.2, 0.0835], [0.921, 6.6, 0.0049],
];
for (const [r, n, p] of ref) {
  const got = m.pValueFromR(r, n);
  ok(`p(r=${r},n=${n})`, near(got, p, 0.0002), `got ${got}`);
}
// tunnetut t-taulukon arvot: t=2.228, df=10 -> p=0.05; t=12.706, df=1 -> 0.05
ok('t=2.228 df=10', near(m.tTwoSidedP(2.228, 10), 0.05, 0.0002), m.tTwoSidedP(2.228, 10));
ok('t=12.706 df=1', near(m.tTwoSidedP(12.706, 1), 0.05, 0.0002), m.tTwoSidedP(12.706, 1));
ok('t=0', near(m.tTwoSidedP(0, 20), 1, 1e-9));
// suuri df -> normaalijakauma: t=1.96 -> 0.05
ok('t=1.96 df=1e6', near(m.tTwoSidedP(1.96, 1e6), 0.05, 0.0002), m.tTwoSidedP(1.96, 1e6));
ok('n<3 -> null', m.pValueFromR(0.5, 2.5) === null);
ok('symmetria', near(m.pValueFromR(-0.4, 30), m.pValueFromR(0.4, 30), 1e-12));

// 2) /greenland-gmb ohittaa ennusterivit
const iso = (d) => d.toISOString().slice(0, 10);
const day = 86400000, now = Date.now();
const gmbCsv = ['time,MB,MB_err'].concat(
  [-3, -2, -1, 0, 1, 2, 3, 4, 5].map((k, i) => `${iso(new Date(now + k * day))},${-6000 - i},1`)
).join('\n');
const smbTxt = ['Otsikko', '20260901   0.732   0.7', '20260902   0.617   1.3', '20260903  -1.5e-1  1.2', 'loppu'].join('\n');
const erddap = (url) => {
  const mm = url.match(/\[\((\d{4}-\d{2}-\d{2})T00:00:00Z\):\((\d{4}-\d{2}-\d{2})T00:00:00Z\)\]/);
  if (!mm) return new Response('bad', { status: 400 });
  if (mm[1] === '2020-04-10') return new Response('upstream', { status: 502 }); // yksi pala kaatuu
  const rows = ['time,latitude,longitude,v', 'UTC,deg,deg,x'];
  for (let t = Date.parse(mm[1]); t <= Date.parse(mm[2]); t += day) rows.push(`${iso(new Date(t))}T12:00:00Z,60,-30,${(t / day) % 7}`);
  return new Response(rows.join('\n'));
};
const calls = [];
globalThis.fetch = async (u) => {
  const url = String(u); calls.push(url);
  if (url.includes('MB_cumulative.csv')) return new Response(gmbCsv);
  if (url.includes('GSMB.txt')) return new Response(smbTxt);
  if (url.includes('erddap')) return erddap(url);
  if (url.includes('rapid_daily.json')) return new Response(JSON.stringify({ '2020-01-01': { moc: 17, umo: -18, gs: 31, ek: 4 }, '2020-01-02': { moc: 18, umo: -18, gs: 31, ek: null } }));
  return new Response('nf', { status: 404 });
};
const get = async (path) => { const r = await worker.fetch(new Request('https://x' + path), {}, {}); return [r.status, await r.json()]; };

{
  const [st, d] = await get('/greenland-gmb');
  ok('gmb status', st === 200);
  ok('gmb paivays <= tanaan', d.viimeisin.date === iso(new Date(now)), d.viimeisin.date);
  ok('gmb ennusteriveja 5', d.ennusteriveja_ohitettu === 5, d.ennusteriveja_ohitettu);
  ok('gmb paivamuutos -1', d.viimeisin.daily_rate_gt === -1, d.viimeisin.daily_rate_gt);
}
{
  const [st, d] = await get('/greenland-smb');
  ok('smb jasennetty 2', st === 200 && d.pisteita_jasennetty === 2, d.pisteita_jasennetty);
  ok('smb hylatty 1 (eksponenttimuoto)', d.hylattyja_datarivin_nakoisia === 1, JSON.stringify(d.hylatyt_nayte));
  ok('smb ika', typeof d.viimeisin_ika_vrk === 'number');
}
// 3) /series
{
  const [st, d] = await get('/series?name=rapid_moc&start=2020-01-01&end=2020-12-31');
  ok('series rapid', st === 200 && d.pisteita === 2 && d.data[0][1] === 17, JSON.stringify(d).slice(0, 200));
  const [st2, d2] = await get('/series?name=rapid_ek&start=2020-01-01&end=2020-12-31');
  ok('series rapid null pois', st2 === 200 && d2.pisteita === 1);
}
{
  calls.length = 0;
  const [st, d] = await get('/series?name=sst&start=2020-01-01&end=2020-12-31&chunk=100');
  const n = calls.filter(u => u.includes('erddap')).length;
  ok('series sst 4 palaa', st === 200 && n === 4 && d.erddap_paloja === 4, `${st} ${n}`);
  ok('series sst epaonnistunut pala raportoitu', d.epaonnistuneet_palat.length === 1 && d.epaonnistuneet_palat[0].start === '2020-04-10', JSON.stringify(d.epaonnistuneet_palat));
  ok('series sst pisteet', d.pisteita === 366 - 100, d.pisteita);
  ok('series sst jarjestys', d.ensimmainen === '2020-01-01' && d.viimeinen === '2020-12-31');
}
{
  const [st, d] = await get('/series?name=sst&start=2004-01-01&end=2024-01-01&chunk=90');
  ok('series liian pitka -> 400', st === 400 && /raja/.test(d.error), JSON.stringify(d));
  const [st2] = await get('/series?name=foo&start=2020-01-01&end=2020-02-01');
  ok('series tuntematon -> 400', st2 === 400);
  const [st3] = await get('/series?name=sst&start=2020-02-01&end=2020-01-01');
  ok('series start>end -> 400', st3 === 400);
  calls.length = 0;
  const [st4, d4] = await get('/series?name=sla&start=2020-05-01&end=2020-06-30');
  ok('series sla ero', st4 === 200 && d4.pisteita === 61 && d4.data.every(x => x[1] === 0) && d4.erddap_paloja === 6, JSON.stringify(d4).slice(0, 300));
}
// 3b) /compare: 30 vrk:n palat, perakkain, kausisyklivaroitus mukana
{
  calls.length = 0;
  const [st, d] = await get('/compare?series_a=sst&series_b=gmb&date=' + iso(new Date(now - 10 * day)) + '&days=120&lag=10');
  const n = calls.filter(u => u.includes('erddap')).length;
  ok('compare sst 30 vrk palat', n === 5, `paloja ${n}, status ${st}, ${JSON.stringify(d).slice(0, 160)}`);
  ok('compare varoitus', st !== 200 || d.notes.some(x => /kausisyklia EI poisteta/.test(x)));
  const [st2, d2] = await get('/compare?series_a=sst&series_b=rapid_moc&date=2020-12-31&days=900');
  ok('compare liian pitka -> virhe', st2 === 502 && /raja 22/.test(d2.error), JSON.stringify(d2).slice(0, 160));
}
// 4) BH: klassinen esimerkki sailyy (ei regressiota)
{
  const bh = m.benjaminiHochberg([0.9, 0.8, 0.7], 0.05);
  ok('BH tyhja', bh.significantIndices.length === 0);
  const bh2 = m.benjaminiHochberg([0.001, 0.008, 0.039, 0.041, 0.6], 0.05);
  ok('BH 2 merkitsevaa', bh2.significantIndices.length === 2, bh2.significantIndices.length);
}
{
  const [st, d] = await get('/status');
  ok('status versio', st === 200 && d.version === '0.2' && '/series' in d.routes);
}
console.log(`${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
