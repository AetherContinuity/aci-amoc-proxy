// ACI AMOC-proxy — Cloudflare Worker
// Rakennettu 2026-07-30, samalla arkkitehtuurilla kuin aci-entsoe-proxy
// ja aci-corine-proxy. Ei API-avaimia tarvita millekaan nailla
// nelja lahteella - kaikki vahvistettu avoimiksi web_fetch-testeilla
// samana paivana (ks. tools/amoc-instrument-plan.md).
//
// TILA: Ensimmainen versio. Kaksi reittia (SLA, SST) kayttavat
// taysin dokumentoitua ERDDAP-kyselymuotoa - LUOTETTAVA. RAPID-info
// vahvistettu toimivaksi mutta EI VIELA parsi itse dataa (vain README).
// Gronlanti/GRACE EI VIELA toteutettu - TU Dresden -portaalin tarkkaa
// formaattia ei ole viela selvitetty.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function handleStatus() {
  return json({
    proxy: 'aci-amoc-proxy',
    version: '0.1',
    purpose: 'AMOC Endurance/Continuity -instrumentin datalahteet',
    reference_doc: 'https://aethercontinuity.org/tools/amoc-instrument-plan.md',
    routes: {
      '/status': 'Taman sivun tila',
      '/sla': 'Merenpinnan korkeuspoikkeama (Sentinel-6-tyyppinen data) - NOAA ERDDAP · ?lat=...&lon=...&date=YYYY-MM-DD · LUOTETTAVA',
      '/sst-anomaly': 'Meriveden lampotila-anomalia - NOAA ERDDAP (OISST) · ?lat=...&lon=...&date=YYYY-MM-DD · LUOTETTAVA',
      '/rapid-info': 'RAPID-AMOC-projektin README (viite/metatiedot, ei viela itse data-arvoja) · EI PARAMETREJA',
    },
    ei_viela_toteutettu: {
      rapid_data: 'Itse moc_transports-datatiedoston tarkka URL/formaatti ei viela varmistettu',
      greenland_grace: 'TU Dresden -portaalin (data1.geo.tu-dresden.de/gis_gmb/) tarkka kyselymuoto ei viela selvitetty',
    },
    caveat: 'Kaikki reitit LUOTETTAVA-merkinnalla on vahvistettu web_fetch-testeilla 2026-07-30, mutta EI VIELA taman proxyn omalla live-testilla (Cloudflare-ymparistosta). Tarkista aina ensimmaisella kayttokerralla.',
  });
}

// ── /sla — Merenpinnan korkeuspoikkeama, NOAA CoastWatch ERDDAP ──
// Dataset: noaacwBLENDEDsshDaily (Sentinel-3A/B, CryoSat-2, Jason-2/3,
// SARAL yhdistetty tuote). 0.25 asteen ruudukko, paivittainen,
// 3-5h viive. Vahvistettu avoimeksi (ei kirjautumista) 2026-07-30.
async function handleSLA(url) {
  const lat = url.searchParams.get('lat') || '26.5';   // oletus: RAPID-taulukon leveysaste
  const lon = url.searchParams.get('lon') || '-50.0';  // oletus: keski-Atlantti
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const erddapUrl = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${date}T00:00:00Z)][(${lat})][(${lon})]`;

  try {
    const r = await fetch(erddapUrl);
    if (!r.ok) {
      throw new Error(`ERDDAP HTTP ${r.status}: ${await r.text()}`);
    }
    const csvText = await r.text();
    return json({
      bem_e_tyylinen_komponentti: 'AMOC — merenpinnan korkeuspoikkeama (SLA)',
      lahde: 'NOAA CoastWatch ERDDAP, dataset noaacwBLENDEDsshDaily',
      kysely: { lat, lon, date },
      raaka_csv: csvText,
      huom: 'Positiivinen arvo = merenpinta korkeampi kuin keskimaarin. Geostrofiset virtaukset voidaan johtaa naapuripisteiden gradientista - ei viela laskettu tassa versiossa.',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla', erddap_url: erddapUrl }, 502);
  }
}

// ── /sst-anomaly — Meriveden lampotila-anomalia, NOAA ERDDAP (OISST) ──
// Dataset: CRW_sst_anom_v1_0 (Coral Reef Watch -tuote, mutta globaali
// kattavuus soveltuu myos Pohjois-Atlantin subpolaariseen alueeseen).
// Referenssi-ilmasto 1991-2020. Vahvistettu avoimeksi 2026-07-30.
async function handleSSTAnomaly(url) {
  const lat = url.searchParams.get('lat') || '60.0';   // oletus: subpolaarinen Pohjois-Atlantti ("kylma laiska")
  const lon = url.searchParams.get('lon') || '-30.0';
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const erddapUrl = `https://oceanwatch.pifsc.noaa.gov/erddap/griddap/CRW_sst_anom_v1_0.csv?sea_surface_temperature_anomaly[(${date}T00:00:00Z)][(${lat})][(${lon})]`;

  try {
    const r = await fetch(erddapUrl);
    if (!r.ok) {
      throw new Error(`ERDDAP HTTP ${r.status}: ${await r.text()}`);
    }
    const csvText = await r.text();
    return json({
      bem_e_tyylinen_komponentti: 'AMOC — Pohjois-Atlantin SST-anomalia ("kylma laiska")',
      lahde: 'NOAA ERDDAP (oceanwatch.pifsc.noaa.gov), dataset CRW_sst_anom_v1_0 (OISST-pohjainen)',
      kysely: { lat, lon, date },
      raaka_csv: csvText,
      huom: 'Negatiivinen anomalia subpolaarisella alueella (~50-65N, Gronlannin-Islannin-Norjan edustalla) on yksi AMOC-heikkenemisen tunnetuista "sormenjaljista" (cold blob).',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sst-anomaly', erddap_url: erddapUrl }, 502);
  }
}

// ── /rapid-info — RAPID-AMOC:n oma README, vahvistettu avoimeksi ──
// EI VIELA parsi itse data-arvoja (moc_transports-tiedoston tarkka
// URL ei viela varmistettu) - palauttaa vain viitetekstin.
async function handleRapidInfo() {
  const readmeUrl = 'https://rapid.ac.uk/sites/default/files/rapid_data/README.pdf';
  try {
    const r = await fetch(readmeUrl);
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    return json({
      bem_e_tyylinen_komponentti: 'AMOC — RAPID-taulukko (26.5N), viitetiedot',
      lahde: 'rapid.ac.uk (BODC/NERC/NSF/NOAA-rahoitteinen)',
      huom: 'Tama reitti hakee vain README:n vahvistaakseen etta yhteys toimii ilman kirjautumista. Itse MOC-kuljetusarvot (Sv) vaativat viela erillisen, tarkemman datatiedoston loytamisen - ks. amoc-instrument-plan.md kohta "Seuraavat askeleet".',
      tunnetut_tilastot_2004_2024: {
        gulf_stream_sv: '31.8 +/- 3.4',
        ekman_sv: '3.8 +/- 3.4',
        yla_keskiokeaani_sv: '-18.4 +/- 3.4',
        moc_sv: '17.1 +/- 4.4',
        unadw_sv: '-12.1 +/- 2.5',
        lnadw_sv: '-5.8 +/- 2.8',
        lahde: 'rapid.ac.uk/data/integrated-transports (haettu 2026-07-30)',
      },
      readme_saatavilla: r.ok,
    });
  } catch (e) {
    return json({ error: e.message, step: 'rapid-info' }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      if (path === '/status' || path === '/') {
        return await handleStatus();
      } else if (path === '/sla') {
        return await handleSLA(url);
      } else if (path === '/sst-anomaly') {
        return await handleSSTAnomaly(url);
      } else if (path === '/rapid-info') {
        return await handleRapidInfo();
      }
      return json({ error: `Unknown route: ${path}` }, 404);
    } catch (e) {
      return json({ error: e.message, step: 'top-level' }, 500);
    }
  },
};
