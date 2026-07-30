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
      '/sla': 'Merenpinnan korkeuspoikkeama, yksi piste (Sentinel-6-tyyppinen data) - NOAA ERDDAP · ?lat=...&lon=...&date=YYYY-MM-DD · LUOTETTAVA MUTTA EI GEOSTROFINEN (yksi piste ei tuota gradienttia)',
      '/sla-gradient': 'Ita-lansi-korkeusero 26.5N (kokeellinen approksimaatio RAPID:n menetelmasta) - ?lat=...&lonWest=...&lonEast=...&date=YYYY-MM-DD',
      '/sst-anomaly': 'Meriveden lampotila-anomalia - NOAA ERDDAP (OISST) · ?lat=...&lon=...&date=YYYY-MM-DD · LUOTETTAVA',
      '/rapid-info': 'RAPID-AMOC-projektin README (viite/metatiedot, ei viela itse data-arvoja) · EI PARAMETREJA',
      '/greenland-smb': 'Gronlannin pintamassatase - DMI Polar Portal · EI PARAMETREJA (palauttaa koko sarjan) · LUOTETTAVA',
    },
    ei_viela_toteutettu: {
      rapid_data: 'Itse moc_transports-datatiedoston tarkka URL/formaatti ei viela varmistettu',
      greenland_grace: 'PODAAC:n GRACE-kokonaismassatase vaatii aidon NASA Earthdata-kirjautumisen (vahvistettu, ei kierrettavissa). /greenland-smb tarjoaa avoimen VAIHTOEHDON (pintamassatase, ei sama suure).',
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
      huom: 'Yksi piste EI riita geostrofisen gradientin laskentaan (gradientti on maaritelmallisesti kahden pisteen erotus) - kayta /sla-gradient-reittia jos tarvitset ita-lansi-eroa. Tama reitti on kokeellinen aikasarja, ei geostrofinen lahde sellaisenaan.',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla', erddap_url: erddapUrl }, 502);
  }
}

// ── /sla-gradient — Ita-lansi-korkeusero 26.5N, RAPID:n oman metodin mukaisesti ──
// LISATTY 2026-07-30, kayttajan (ja hanen harrastelijaystavansa) oma
// fysikaalinen kritiikki: yhden pisteen SLA EI VOI tuottaa geostrofista
// gradienttia, koska gradientti on maaritelmallisesti kahden pisteen
// erotus. RAPID:n oma menetelma summaa Florida-salmen (lansireuna) +
// sisaosan geostrofinen + Kanariansaaret (itareuna) -komponentit.
// Tama reitti approksimoi tata: lansipiste ~75W (lahella Floridan
// salmea), itapiste ~15W (lahella Kanariansaaria), molemmat 26.5N.
// HUOM: tama ei ole sama kuin RAPID:n oma, tarkka laskenta (joka
// kayttaa taysia syvyysprofiileja, ei vain pintakorkeutta) - tama on
// karkea, kokeellinen approksimaatio samasta periaatteesta.
async function handleSLAGradient(url) {
  const lat = url.searchParams.get('lat') || '26.5';
  const lonWest = url.searchParams.get('lonWest') || '-75';
  const lonEast = url.searchParams.get('lonEast') || '-15';
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const urlWest = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${date}T00:00:00Z)][(${lat})][(${lonWest})]`;
  const urlEast = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${date}T00:00:00Z)][(${lat})][(${lonEast})]`;

  try {
    const [rWest, rEast] = await Promise.all([fetch(urlWest), fetch(urlEast)]);
    if (!rWest.ok) throw new Error(`Lansipiste ERDDAP HTTP ${rWest.status}: ${await rWest.text()}`);
    if (!rEast.ok) throw new Error(`Itapiste ERDDAP HTTP ${rEast.status}: ${await rEast.text()}`);

    const parseSLA = (csv) => {
      const lines = csv.trim().split('\n');
      const last = lines[lines.length - 1].split(',');
      return { time: last[0], lat: parseFloat(last[1]), lon: parseFloat(last[2]), sla: parseFloat(last[3]) };
    };
    const west = parseSLA(await rWest.text());
    const east = parseSLA(await rEast.text());
    const gradient = east.sla - west.sla;

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — ita-lansi-korkeusero (kokeellinen, ei RAPID:n tarkka menetelma)',
      lahde: 'NOAA CoastWatch ERDDAP, kaksi pistetta samalta leveyspiirilta',
      kysely: { lat, lonWest, lonEast, date },
      lansipiste: west,
      itapiste: east,
      korkeusero_m: Number(gradient.toFixed(4)),
      huom: 'Tama approksimoi RAPID:n oman menetelman periaatetta (lansi+sisaosa+ita-komponentit) mutta KARKEASTI - ei kayta taysia syvyysprofiileja kuten RAPID itse. Yhden paivan arvo on todennakoisesti enemman mesoskaalapyorteiden kohinaa kuin AMOC-signaalia - tarvitaan vahintaan 30-60 vrk liukuva keskiarvo ennen tulkintaa (kayttajan oma huomio 2026-07-30).',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla-gradient' }, 502);
  }
}

// ── /sst-anomaly — Meriveden lampotila-anomalia, NOAA ERDDAP ──
// KORJATTU 2026-07-30: alkuperainen dataset (CRW_sst_anom_v1_0,
// oceanwatch.pifsc.noaa.gov) esti robotit oman web_fetch-tyokaluni
// puolelta, ja Workerin oma haku antoi 404 (todennakoisesti vaarasta
// muuttujanimesta - arvasin CF-standard_name:n "sea_surface_
// temperature_anomaly" sen sijaan etta olisin kayttanyt oikeaa,
// lyhytta ERDDAP-muuttujanimea).
//
// VAIHDETTU: sama palvelin kuin /sla (coastwatch.noaa.gov, jo
// vahvistettu toimivaksi), dataset noaacrwsstanomalyDaily ("Sea
// Surface Temperature Anomaly, NOAA Coral Reef Watch Daily Global
// 5km Satellite SST Anomaly, 1985-present, Daily").
//
// MUUTTUJANIMI ON ARVIO, EI VIELA VARMISTETTU: kaytetaan "sstAnom"
// analogisen datasetin (jplMURSST41anom1day) perusteella - useat
// ERDDAP-anomaliadatasetit kayttavat tata lyhytta camelCase-muotoa.
// Jos tama epaonnistuu, seuraava askel on hakea taman TARKAN
// datasetin oma .das-tiedosto muuttujan nimen varmistamiseksi.
async function handleSSTAnomaly(url) {
  const lat = url.searchParams.get('lat') || '60.0';   // oletus: subpolaarinen Pohjois-Atlantti ("kylma laiska")
  const lon = url.searchParams.get('lon') || '-30.0';
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

  // KORJATTU 2026-07-30 (toinen yritys): "sstAnom" ei loytynyt -
  // ERDDAP:n oma virhe vahvisti etta dataset ITSE on oikea, vain
  // muuttujan nimi vaarin. Kokeillaan CRW-tuotteiden yleista
  // nimeamiskaytantoa (isot kirjaimet + alaviiva, esim. CRW_DHW
  // "degree heating week" -datasetissa) - EDELLEEN ARVIO.
  // VAHVISTETTU 2026-07-30 (kolmas yritys, .das-varajarjestely toimi):
  // oikea muuttujan nimi on "sea_surface_temperature_anomaly" -
  // ERDDAP:n oma .das-tiedosto paljasti taman suoraan kun aiemmat
  // arvaukset (sstAnom, CRW_SSTANOMALY) epaonnistuivat.
  const datasetId = 'noaacrwsstanomalyDaily';
  const varName = 'sea_surface_temperature_anomaly';
  const erddapUrl = `https://coastwatch.noaa.gov/erddap/griddap/${datasetId}.csv?${varName}[(${date}T00:00:00Z)][(${lat})][(${lon})]`;

  try {
    const r = await fetch(erddapUrl);
    if (!r.ok) {
      throw new Error(`ERDDAP HTTP ${r.status}: ${await r.text()}`);
    }
    const csvText = await r.text();
    return json({
      bem_e_tyylinen_komponentti: 'AMOC — Pohjois-Atlantin SST-anomalia ("kylma laiska")',
      lahde: 'NOAA ERDDAP (coastwatch.noaa.gov), dataset noaacrwsstanomalyDaily (Coral Reef Watch, globaali)',
      kysely: { lat, lon, date },
      raaka_csv: csvText,
      huom: 'Negatiivinen anomalia subpolaarisella alueella (~50-65N, Gronlannin-Islannin-Norjan edustalla) on yksi AMOC-heikkenemisen tunnetuista "sormenjaljista" (cold blob).',
    });
  } catch (e) {
    // ALYKAS VARAJARJESTELY 2026-07-30: jos muuttujan nimi on vaarin,
    // haetaan datasetin oma .das-tiedosto (sisaltaa KAIKKI oikeat
    // muuttujanimet) ja liitetaan vastaukseen - lopettaa arvailun,
    // seuraava korjaus voi kayttaa tasta suoraan oikeaa nimea.
    let dasContent = null;
    try {
      const dasUrl = `https://coastwatch.noaa.gov/erddap/griddap/${datasetId}.das`;
      const dasR = await fetch(dasUrl);
      if (dasR.ok) dasContent = await dasR.text();
    } catch (dasErr) {
      dasContent = `(.das-haku itsekin epaonnistui: ${dasErr.message})`;
    }
    return json({
      error: e.message,
      step: 'sst-anomaly',
      erddap_url: erddapUrl,
      huom: `Muuttujanimi "${varName}" oli arvio. Alla datasetin oma .das-tiedosto joka listaa KAIKKI oikeat muuttujanimet - etsi rivi jossa on ioos_category "Temperature" tai vastaava.`,
      dataset_das: dasContent,
    }, 502);
  }
}

// ── /rapid-info — RAPID-AMOC:n viitetilastot, staattinen ──
// KORJATTU 2026-07-30: alkuperainen versio haki README.pdf:n joka
// osoitti live-testissa "onk"-tuloksen web_fetch-tyokalulla, MUTTA
// Cloudflare Workerin oma fetch() sai HTTP 404 samasta osoitteesta -
// todennakoisesti rapid.ac.uk kohtelee Cloudflaren edge-liikennetta
// eri tavalla (botti-suodatus tms.). Koska tama reitti ei muutenkaan
// lataa mitaan aidosti elavaa dataa (vain viitetilastot, jotka olivat
// jo kovakoodattuina), yksinkertaisin ja kestavin korjaus on poistaa
// epaluotettava verkkoriippuvuus kokonaan.
async function handleRapidInfo() {
  return json({
    bem_e_tyylinen_komponentti: 'AMOC — RAPID-taulukko (26.5N), viitetiedot',
    lahde: 'rapid.ac.uk (BODC/NERC/NSF/NOAA-rahoitteinen)',
    huom: 'Staattiset viitetilastot - ei live-hakua (rapid.ac.uk kohteli Cloudflare Workerin liikennetta eri tavalla kuin web_fetch-tyokalua, HTTP 404 vaikka osoite on oikea). Itse MOC-kuljetusarvot (Sv) vaativat viela erillisen, tarkemman datatiedoston loytamisen - ks. amoc-instrument-plan.md kohta "Seuraavat askeleet".',
    tunnetut_tilastot_2004_2024: {
      gulf_stream_sv: '31.8 +/- 3.4',
      ekman_sv: '3.8 +/- 3.4',
      yla_keskiokeaani_sv: '-18.4 +/- 3.4',
      moc_sv: '17.1 +/- 4.4',
      unadw_sv: '-12.1 +/- 2.5',
      lnadw_sv: '-5.8 +/- 2.8',
      lahde: 'rapid.ac.uk/data/integrated-transports (haettu 2026-07-30)',
    },
  });
}

// ── /greenland-smb — Gronlannin pintamassatase, DMI Polar Portal ──
// LISATTY 2026-07-30. Taysin avoin, ei kirjautumista - vahvistettu
// web_fetch:illa. HUOM: tama on PINTAmassatase (SMB, malli: sadanta -
// sulaminen), EI GRACE:n oma kokonaismassatase (joka sisaltaisi myos
// jaatikoiden kalvamisen/discharge). Eri mutta laheisesti liittyva
// suure - PODAAC:n GRACE-data vaatisi aidon Earthdata-kirjautumisen
// (vahvistettu, ei kierrettavissa), tama on paras avoin vaihtoehto.
async function handleGreenlandSMB() {
  const smbUrl = 'https://download.dmi.dk/Research_Projects/polarportal/PP_GSMB/GSMB.txt';
  try {
    const r = await fetch(smbUrl);
    if (!r.ok) {
      throw new Error(`DMI HTTP ${r.status}`);
    }
    const text = await r.text();
    // Jasennetaan rivit jotka alkavat 8-numeroisella paivamaaralla
    // (YYYYMMDD SMB(Gt/d) SMBacc(Gt)) - loppuosa tiedostosta on
    // vapaamuotoista tekstia/otsikoita jotka ohitetaan.
    const lines = text.split('\n');
    const dataLines = lines
      .map(l => l.trim())
      .filter(l => /^\d{8}\s+-?\d+\.?\d*\s+-?\d+\.?\d*$/.test(l));
    const parsed = dataLines.map(l => {
      const [dateStr, smb, smbAcc] = l.split(/\s+/);
      return {
        date: `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`,
        smb_gt_per_day: parseFloat(smb),
        smb_acc_gt: parseFloat(smbAcc),
      };
    });
    const latest = parsed[parsed.length - 1] || null;

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — Gronlannin makean veden indikaattori (pintamassatase)',
      lahde: 'DMI Polar Portal (download.dmi.dk), HARMONIE-AROME IGB -malli',
      huom: 'PINTAmassatase (sadanta - sulaminen), EI GRACE:n kokonaismassatase (ei sisalla jaatikoiden kalvamista). PODAAC:n GRACE-data vaatisi aidon NASA Earthdata -kirjautumisen (vahvistettu, ei kierrettavissa) - tama on paras avoin vaihtoehto.',
      pisteita_jasennetty: parsed.length,
      viimeisin: latest,
      koko_sarja: parsed,
    });
  } catch (e) {
    return json({ error: e.message, step: 'greenland-smb', smb_url: smbUrl }, 502);
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
      } else if (path === '/sla-gradient') {
        return await handleSLAGradient(url);
      } else if (path === '/sst-anomaly') {
        return await handleSSTAnomaly(url);
      } else if (path === '/rapid-info') {
        return await handleRapidInfo();
      } else if (path === '/greenland-smb') {
        return await handleGreenlandSMB();
      }
      return json({ error: `Unknown route: ${path}` }, 404);
    } catch (e) {
      return json({ error: e.message, step: 'top-level' }, 500);
    }
  },
};
