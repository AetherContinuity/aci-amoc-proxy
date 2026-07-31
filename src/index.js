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
      '/sla-gradient-mean': '30 vrk (oletus) liukuva keskiarvo ita-lansi-korkeuserosta, tasoittaa mesoskaalakohinaa - ?lat=...&lonWest=...&lonEast=...&endDate=YYYY-MM-DD&days=N',
      '/sla-gradient-anomaly': 'Kausikorjattu anomalia (gradientti miinus kuukauden klimatologia, 2v data) - ?lat=...&lonWest=...&lonEast=...&date=YYYY-MM-DD',
      '/sst-anomaly': 'Meriveden lampotila-anomalia - NOAA ERDDAP (OISST) · ?lat=...&lon=...&date=YYYY-MM-DD · LUOTETTAVA',
      '/rapid-info': 'RAPID-AMOC-projektin README (viite/metatiedot, ei viela itse data-arvoja) · EI PARAMETREJA',
      '/greenland-smb': 'Gronlannin pintamassatase - DMI Polar Portal · EI PARAMETREJA (palauttaa koko sarjan) · LUOTETTAVA',
      '/nao': 'Pohjois-Atlantin oskillaatio - NOAA PSL · ?date=YYYY-MM-DD (yksi arvo) tai ?date=...&days=N (aikasarja) · LUOTETTAVA, mutta hidas suurilla days-arvoilla (koko 1948-tiedosto haetaan joka kerta)',
      '/sla-gradient-nao-correlation': 'Pearson-korrelaatio ita-lansi-gradientin ja NAO:n valilla - ?lat=...&lonWest=...&lonEast=...&endDate=YYYY-MM-DD&days=N · HUOM: NAO-data ~4.5kk viiveella, vain paallekkaiset paivat kaytetaan',
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

// ── /sla-gradient-mean — 30 vrk keskiarvo ita-lansi-korkeuserosta ──
// LISATTY 2026-07-30, jatkoa kayttajan ja hanen harrastelijaystavansa
// kvantitatiiviselle analyysille: yhden paivan gradientti (-0.048 m)
// vastaisi ~0.8 m/s nopeutta jos koko vesipatsas liikkuisi - epa-
// realistisen korkea verrattuna RAPID:n omaan ~0.1-0.3 m/s -tasoon,
// mika vahvisti etta yksittainen paiva on mesoskaalakohinan dominoima.
// Tama reitti hakee 30 vrk aikasarjan MOLEMMILLE pisteille samalla,
// jo vahvistetusti toimivalla ERDDAP-lahteella (ei uutta CMEMS-avainta
// tarvita), laskee paivittaisen gradientin ja sen 30 vrk keskiarvon.
// ── Kuukausittainen klimatologia ita-lansi-gradientille ──
// LISATTY 2026-07-30. Laskettu kahdesta havaitusta vuodesta
// (2024-07-28...2025-07-28 ja 2025-07-28...2026-07-28, yhteensa 729
// paivaa) samalta lansi(~75W)/ita(~15W)/26.5N-pisteparilta kuin
// /sla-gradient kayttaa. Paljastaa selvan kausisyklin: helmi-maaliskuu
// huippu (~+0.12), elo-syyskuu pohja (~-0.10) - todennakoisesti
// steerinen (lampolaajenemis-) ilmio, ei AMOC-signaali sellaisenaan
// (ks. amoc-instrument-plan.md). Kayttajan oma prioriteetti 2026-07-30:
// kausikorjattu anomalia on arvokkaampi kuin raaka arvo tai
// kausivaihtelun peittama liukuva keskiarvo.
const GRADIENT_CLIMATOLOGY_BY_MONTH = {
  1: 0.0149, 2: 0.1183, 3: 0.1249, 4: 0.0806, 5: 0.0675, 6: 0.0175,
  7: -0.0288, 8: -0.0964, 9: -0.1024, 10: 0.0194, 11: 0.0317, 12: 0.0073,
};

async function handleSLAGradientAnomaly(url) {
  const lat = url.searchParams.get('lat') || '26.5';
  const lonWest = url.searchParams.get('lonWest') || '-75';
  const lonEast = url.searchParams.get('lonEast') || '-15';
  const date = url.searchParams.get('date') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);

  const urlWest = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${date}T00:00:00Z)][(${lat})][(${lonWest})]`;
  const urlEast = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${date}T00:00:00Z)][(${lat})][(${lonEast})]`;

  try {
    const [rWest, rEast] = await Promise.all([fetch(urlWest), fetch(urlEast)]);
    if (!rWest.ok) throw new Error(`Lansipiste ERDDAP HTTP ${rWest.status}: ${await rWest.text()}`);
    if (!rEast.ok) throw new Error(`Itapiste ERDDAP HTTP ${rEast.status}: ${await rEast.text()}`);

    const parseSLA = (csv) => {
      const lines = csv.trim().split('\n');
      const last = lines[lines.length - 1].split(',');
      return { time: last[0], sla: parseFloat(last[3]) };
    };
    const west = parseSLA(await rWest.text());
    const east = parseSLA(await rEast.text());
    const gradient = east.sla - west.sla;

    const month = parseInt(date.split('-')[1], 10);
    const climatology = GRADIENT_CLIMATOLOGY_BY_MONTH[month];
    const anomaly = gradient - climatology;

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — ita-lansi-korkeuseron kausikorjattu anomalia',
      lahde: 'NOAA CoastWatch ERDDAP + kovakoodattu klimatologia (729 paivaa, 2024-2026)',
      kysely: { lat, lonWest, lonEast, date, kuukausi: month },
      gradientti_m: Number(gradient.toFixed(5)),
      klimatologia_m: climatology,
      anomalia_m: Number(anomaly.toFixed(5)),
      huom: 'KORJATTU YMMARRYS 2026-07-30: kolme lisavuosiparia (2019-2020, 2020-2021) paljastivat etta jokainen vuosi nayttaa TAYSIN ERI vaiheen (pohja/huippu eri kuukausina) - talla ei siis olekaan kiintea, kalenteriin sidottu vuosisykli. Kirjallisuushaku selitti taman: Frajka-Williams (2015) ja RAPID:n oma 20v yhteenveto vahvistavat etta tama signaali (UMO-proksi 26N) on VUOSIENVALISEN (interannual, Rossby-aalto-) vaihtelun hallitsema, ei kausivaihtelun. Alla oleva anomalia_m kuvaa siis eroa vain KAHDEN VUODEN otokseen, EI vakiintunutta normaalia - tulkitse varovasti. Ks. amoc-instrument-plan.md kohta "KORJAUS 2026-07-30".',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla-gradient-anomaly' }, 502);
  }
}

async function handleSLAGradientMean(url) {
  const lat = url.searchParams.get('lat') || '26.5';
  const lonWest = url.searchParams.get('lonWest') || '-75';
  const lonEast = url.searchParams.get('lonEast') || '-15';
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  // KORJATTU 2026-07-30: alkuperainen oletus (tama paiva) aiheutti
  // ERDDAP HTTP 404 -virheen, koska nain nain-reaaliaikaisella
  // datasetilla on ~2 vrk viive (havaittu: data ulottui vain
  // 2026-07-29 asti kun kysyttiin 2026-07-31 asti). Sama viive jo
  // huomioitu AMOC-monitor.html:n omassa SLA-kortissa (-3 vrk) - lisatty
  // sama oletus tanne, jotta oletusarvoinen kutsu ei koskaan
  // epaonnistu ilman etta kayttaja itse antaa endDate-parametrin.
  const endDate = url.searchParams.get('endDate') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);

  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);

  const urlWest = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${endDate}T00:00:00Z)][(${lat})][(${lonWest})]`;
  const urlEast = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${endDate}T00:00:00Z)][(${lat})][(${lonEast})]`;

  try {
    const [rWest, rEast] = await Promise.all([fetch(urlWest), fetch(urlEast)]);
    if (!rWest.ok) throw new Error(`Lansipiste ERDDAP HTTP ${rWest.status}: ${await rWest.text()}`);
    if (!rEast.ok) throw new Error(`Itapiste ERDDAP HTTP ${rEast.status}: ${await rEast.text()}`);

    const parseRows = (csv) => {
      const lines = csv.trim().split('\n').slice(2); // ohita otsikko + yksikkorivi
      return lines.map(l => {
        const [time, , , sla] = l.split(',');
        return { date: time.slice(0, 10), sla: parseFloat(sla) };
      }).filter(r => !Number.isNaN(r.sla));
    };
    const westRows = parseRows(await rWest.text());
    const eastRows = parseRows(await rEast.text());

    // Yhdistetaan paivamaaran mukaan (Map-pohjainen haku, ei oleteta
    // samaa jarjestysta/pituutta molemmissa sarjoissa)
    const westByDate = new Map(westRows.map(r => [r.date, r.sla]));
    const dailyGradients = eastRows
      .filter(r => westByDate.has(r.date))
      .map(r => ({ date: r.date, gradient: r.sla - westByDate.get(r.date) }));

    if (!dailyGradients.length) {
      throw new Error('Ei paallekkaisia paivamaaria lansi- ja itapisteen valilla');
    }

    const meanGradient = dailyGradients.reduce((a, b) => a + b.gradient, 0) / dailyGradients.length;
    const values = dailyGradients.map(d => d.gradient);
    const stdev = Math.sqrt(values.reduce((a, b) => a + (b - meanGradient) ** 2, 0) / values.length);

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — ita-lansi-korkeuseron 30 vrk liukuva keskiarvo',
      lahde: 'NOAA CoastWatch ERDDAP, sama dataset kuin /sla-gradient',
      kysely: { lat, lonWest, lonEast, startDate: startStr, endDate, pyydettyPaivia: days },
      pisteita_yhdistetty: dailyGradients.length,
      keskiarvo_gradientti_m: Number(meanGradient.toFixed(5)),
      keskihajonta_m: Number(stdev.toFixed(5)),
      paivittaiset_arvot: dailyGradients,
      huom: 'Keskiarvo tasoittaa mesoskaalapyorteiden kohinaa yksittaisesta paivasta, mutta EI VIELA korreloi suoraan RAPID:n kanssa - RAPID sisaltaa myos Florida-salmen virtauksen (jota SLA ei nae) ja pohjan tiheysrakenteen. Tama on askel oikeaan suuntaan, ei validointi.',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla-gradient-mean' }, 502);
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

// ── /nao — Pohjois-Atlantin oskillaatio, NOAA PSL ──
// LISATTY 2026-07-30, kayttajan oma kysymys ("ovatko muut havainneet
// korrelaatiota lampenemisen/ilmakehan muutoksen kanssa?") johti
// kirjallisuushakuun (Zhao 2014, Roach 2022, Polo 2014) joka vahvisti
// suoran yhteyden: itä-lansi-gradientin (UMO-proksi) vuosienvalinen
// vaihtelu on TUULEN AJAMAA ja korreloi NAO:n kanssa. Taysin avoin,
// ei kirjautumista - vahvistettu web_fetch:illa. Paivittainen data
// 1948-nykyhetki, EOF-pohjainen (500mb-korkeuskentat, NCEP/NCAR R1).
// HUOM: koko tiedosto (~30000+ riviä) haetaan ja suodatetaan joka
// kutsulla - ei sisaanrakennettua paivamaarasuodatusta palvelimella
// (toisin kuin ERDDAP). Voi olla hidas suurilla days-arvoilla.
async function handleNAO(url) {
  const date = url.searchParams.get('date') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);
  const days = url.searchParams.get('days') ? parseInt(url.searchParams.get('days'), 10) : null;

  const naoUrl = 'https://downloads.psl.noaa.gov/Public/map/teleconnections/nao.reanalysis.t10trunc.1948-present.txt';

  try {
    const r = await fetch(naoUrl);
    if (!r.ok) {
      throw new Error(`PSL HTTP ${r.status}`);
    }
    const text = await r.text();
    const lines = text.split('\n');
    const dataLines = lines
      .map(l => l.trim())
      .filter(l => /^\d{4}\s+\d{1,2}\s+\d{1,2}\s+-?\d+\.?\d*$/.test(l));
    const parsed = dataLines.map(l => {
      const parts = l.split(/\s+/);
      const y = parts[0], m = parts[1].padStart(2, '0'), d = parts[2].padStart(2, '0');
      return { date: `${y}-${m}-${d}`, nao: parseFloat(parts[3]) };
    });

    if (days) {
      const endD = new Date(date + 'T00:00:00Z');
      const startD = new Date(endD.getTime() - days * 24 * 3600 * 1000);
      const filtered = parsed.filter(p => {
        const pd = new Date(p.date + 'T00:00:00Z');
        return pd >= startD && pd <= endD;
      });
      const values = filtered.map(p => p.nao);
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      return json({
        bem_e_tyylinen_komponentti: 'AMOC — Pohjois-Atlantin oskillaatio (NAO), aikasarja',
        lahde: 'NOAA PSL (downloads.psl.noaa.gov), EOF-pohjainen, NCEP/NCAR R1',
        kysely: { date, days, pisteita: filtered.length },
        keskiarvo_nao: mean !== null ? Number(mean.toFixed(2)) : null,
        koko_sarja: filtered,
        huom: 'Kirjallisuus (Zhao 2014, Roach 2022) vahvistaa: AMOC:n vuosienvalinen vaihtelu 26.5N:lla on tuulen ajamaa ja korreloi NAO:n kanssa. Vertaa tata /sla-gradient-mean-reitin tuloksiin samalta ajalta.',
      });
    }

    const latest = parsed.find(p => p.date === date) || parsed[parsed.length - 1];
    return json({
      bem_e_tyylinen_komponentti: 'AMOC — Pohjois-Atlantin oskillaatio (NAO)',
      lahde: 'NOAA PSL (downloads.psl.noaa.gov), EOF-pohjainen, NCEP/NCAR R1',
      kysely: { date },
      loydetty: latest,
      huom: 'Kirjallisuus (Zhao 2014, Roach 2022) vahvistaa: AMOC:n vuosienvalinen vaihtelu 26.5N:lla on tuulen ajamaa ja korreloi NAO:n kanssa. Kayta &days=N palauttaaksesi aikasarjan vertailua varten.',
    });
  } catch (e) {
    return json({ error: e.message, step: 'nao', nao_url: naoUrl }, 502);
  }
}

// ── /sla-gradient-nao-correlation — Pearson-korrelaatio gradientin ja NAO:n valilla ──
// LISATTY 2026-07-30. Silmamaarainen vertailu osoittautui ristiriitaiseksi
// (marraskuu 2025: NAO aarimm. negatiivinen, gradientti positiivinen -
// helmi-maalis 2026: molemmat positiivisia) - sama periaate kuin WEM:n
// hinta/tuuli-kaaviossa: lasketaan tasmallinen Pearson r, ei luoteta
// vaikutelmaan. HUOM: NAO-data ei ulotu yhta pitkalle kuin gradientti
// (havaittu: viimeisin NAO-piste 2026-03-17, ~4.5kk viive) - vain
// paallekkaiset paivamaarat kaytetaan.
async function handleSLAGradientNAOCorrelation(url) {
  const lat = url.searchParams.get('lat') || '26.5';
  const lonWest = url.searchParams.get('lonWest') || '-75';
  const lonEast = url.searchParams.get('lonEast') || '-15';
  const days = parseInt(url.searchParams.get('days') || '365', 10);
  const endDate = url.searchParams.get('endDate') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);

  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);

  const urlWest = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${endDate}T00:00:00Z)][(${lat})][(${lonWest})]`;
  const urlEast = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${endDate}T00:00:00Z)][(${lat})][(${lonEast})]`;
  const naoUrl = 'https://downloads.psl.noaa.gov/Public/map/teleconnections/nao.reanalysis.t10trunc.1948-present.txt';

  try {
    const [rWest, rEast, rNAO] = await Promise.all([fetch(urlWest), fetch(urlEast), fetch(naoUrl)]);
    if (!rWest.ok) throw new Error(`Lansipiste ERDDAP HTTP ${rWest.status}`);
    if (!rEast.ok) throw new Error(`Itapiste ERDDAP HTTP ${rEast.status}`);
    if (!rNAO.ok) throw new Error(`NAO HTTP ${rNAO.status}`);

    const parseRows = (csv) => {
      const lines = csv.trim().split('\n').slice(2);
      return lines.map(l => {
        const [time, , , sla] = l.split(',');
        return { date: time.slice(0, 10), sla: parseFloat(sla) };
      }).filter(r => !Number.isNaN(r.sla));
    };
    const westRows = parseRows(await rWest.text());
    const eastRows = parseRows(await rEast.text());
    const westByDate = new Map(westRows.map(r => [r.date, r.sla]));
    const gradientByDate = new Map();
    eastRows.forEach(r => {
      if (westByDate.has(r.date)) gradientByDate.set(r.date, r.sla - westByDate.get(r.date));
    });

    const naoText = await rNAO.text();
    const naoLines = naoText.split('\n')
      .map(l => l.trim())
      .filter(l => /^\d{4}\s+\d{1,2}\s+\d{1,2}\s+-?\d+\.?\d*$/.test(l));
    const naoByDate = new Map();
    naoLines.forEach(l => {
      const parts = l.split(/\s+/);
      const dateStr = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      naoByDate.set(dateStr, parseFloat(parts[3]));
    });

    // Yhdistetaan VAIN paivamaarat joilta molemmat sarjat loytyvat
    const paired = [];
    for (const [date, gradient] of gradientByDate) {
      if (naoByDate.has(date)) {
        paired.push({ date, gradient, nao: naoByDate.get(date) });
      }
    }
    paired.sort((a, b) => a.date.localeCompare(b.date));

    if (paired.length < 3) {
      throw new Error(`Liian vahan paallekkaisia paivamaaria (${paired.length}) korrelaation laskentaan - NAO-data ei todennakoisesti ulotu pyydetylle valille`);
    }

    // Pearsonin korrelaatiokerroin
    const n = paired.length;
    const xs = paired.map(p => p.gradient), ys = paired.map(p => p.nao);
    const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
    let cov=0, vx=0, vy=0;
    for (let i=0;i<n;i++){ const dx=xs[i]-mx, dy=ys[i]-my; cov+=dx*dy; vx+=dx*dx; vy+=dy*dy; }
    const r = cov / Math.sqrt(vx*vy);

    const naoLastDate = [...naoByDate.keys()].sort().pop();

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — ita-lansi-gradientin ja NAO:n Pearson-korrelaatio',
      lahde: 'NOAA CoastWatch ERDDAP (gradientti) + NOAA PSL (NAO)',
      kysely: { lat, lonWest, lonEast, startDate: startStr, endDate, pyydettyPaivia: days },
      paallekkaisia_paivia: n,
      pearson_r: Number(r.toFixed(4)),
      nao_datan_viimeisin_paiva: naoLastDate,
      huom: r < -0.3 ? 'Kohtalainen/vahva NEGATIIVINEN korrelaatio - odotettu suunta jos NAO kuvaa lantisen reunan lampovuota kaanteisesti gradienttiin' :
            r > 0.3 ? 'Kohtalainen/vahva POSITIIVINEN korrelaatio' :
            'Heikko tai olematon korrelaatio (|r|<0.3) - silmamaarainen vaikutelma ei saanut tilastollista tukea talla otoksella',
    });
  } catch (e) {
    return json({ error: e.message, step: 'sla-gradient-nao-correlation' }, 502);
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
      } else if (path === '/sla-gradient-mean') {
        return await handleSLAGradientMean(url);
      } else if (path === '/sla-gradient-anomaly') {
        return await handleSLAGradientAnomaly(url);
      } else if (path === '/sst-anomaly') {
        return await handleSSTAnomaly(url);
      } else if (path === '/rapid-info') {
        return await handleRapidInfo();
      } else if (path === '/greenland-smb') {
        return await handleGreenlandSMB();
      } else if (path === '/nao') {
        return await handleNAO(url);
      } else if (path === '/sla-gradient-nao-correlation') {
        return await handleSLAGradientNAOCorrelation(url);
      }
      return json({ error: `Unknown route: ${path}` }, 404);
    } catch (e) {
      return json({ error: e.message, step: 'top-level' }, 500);
    }
  },
};
