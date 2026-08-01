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
      '/compare/nao-sla': '(VANHENTUNUT, sailytetty taaksepain-yhteensopivuuden vuoksi - kayta /compare?series_a=sla&series_b=nao)',
      '/compare': 'YLEINEN kahden aikasarjan vertailumoottori - ?series_a=X&series_b=Y&date=YYYY-MM-DD&days=N&lag=N&smooth=N&monthly=N (vain sla/sst: kuukausittainen naytteenotto N kk:n valein, esim. monthly=6 puolivuosittain - valttaa ERDDAP:n pitka-aikavali-502-ongelman JA Cloudflaren 50 alipyynnon rajan; oletukset SST=6kk/~40 alipyyntoa, SLA=12kk/~40 alipyyntoa kahdelle pisteelle; kaikki ERDDAP-kutsut valimuistissa Cache API:lla) · saatavilla: sla, nao, sst, smb (vain nyk. sulamiskausi), gmb (GEUS kokonaismassatase 1986-), rapid_moc, rapid_umo, rapid_gs, rapid_ek (RAPID vain 2004-04-07...2024-03-22, ei live) · palauttaa Pearson r, Spearman rho, effective N (autokorrelaatiokorjattu), lag-spektri, automaattinen tulkinta',
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
// ── /compare/nao-sla — Yleinen viivekorrelaatiotyokalu ──
// LISATTY 2026-07-30, kayttajan oma ehdotus (paransi alkuperaista
// yhden-Pearson-luvun versiota): AMOC:n vuosienvalinen vaihtelu voi
// olla NAO:n tuulipakotteen viivastynytta seurausta, ei samanaikaista.
// Skannaa lag=-30...+30 vrk, palauttaa seka lag=0 etta parhaan |r|:n
// loytaneen viiveen, molemmille p-arvon (normaalijakauma-approksimaatio,
// tarkka kun n>200 - t-jakauma ~ normaali suurella vapausasteella).
// Nayttaa AINA pistemaarat (sla/nao/yhdistetyt) ENNEN korrelaatiota -
// kayttajan oma periaate: "kayttaja nakee heti ettei korrelaatio
// perustunut koko vuoden aineistoon."
//
// ACI-filosofia (kayttajan oma sanoin): hypoteesia ei oleteta oikeaksi,
// vaan sille rakennetaan mitattava testi. Jos korrelaatiota ei loydy,
// sekin on arvokas tulos.
function pearsonR(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let cov=0, vx=0, vy=0;
  for (let i=0;i<n;i++){ const dx=xs[i]-mx, dy=ys[i]-my; cov+=dx*dy; vx+=dx*dx; vy+=dy*dy; }
  return cov / Math.sqrt(vx*vy);
}
// Normaalijakauman kertymafunktion approksimaatio (Abramowitz-Stegun
// 7.1.26). Kayttokelpoinen p-arvon approksimointiin kun n on suuri
// (df=n-2>200), jolloin t-jakauma lahestyy normaalijakaumaa. PIENELLA
// n:lla tama approksimaatio EI ole tarkka - ei kaytetty tassa koska
// kaikki reitin kayttotapaukset tuottavat n>100.
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z*z/2);
  let p = d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
function pValueFromR(r, n) {
  if (n < 3 || Math.abs(r) >= 1) return null;
  const t = r * Math.sqrt((n-2)/(1-r*r));
  const oneSided = 1 - normalCDF(Math.abs(t));
  return Math.min(1, oneSided * 2);
}

// Benjamini-Hochberg FDR-korjaus (1995) monivertailulle.
// LISATTY 2026-07-31, kayttajan oma ehdotus - koska /compare testaa
// -30..+30 vrk (61 viivetta) samanaikaisesti, "paras loydetty r" on
// altis satunnaiselle ylikorostumiselle (jos testataan 61 kertaa,
// jokin niista nayttaa "hyvalta" pelkasta sattumasta viiden prosentin
// merkitsevyystasolla n. 3 kertaa 61:sta odotusarvoisesti). BH-menetelma
// kontrolloi vaarien loytojen odotettua osuutta (false discovery rate)
// kaikkien testien joukossa, ei vain yksittaista p-arvoa.
//
// HUOM tarkeasta JS-ansasta: jos mikaan ei ole merkitseva, maxRank=0 ja
// significantIndices palautetaan tyhjana taulukkona SUORAAN (ei
// array.slice(0,-1):lla, joka JS:ssa tarkoittaisi "kaikki paitsi
// viimeinen" - EI tyhjaa taulukkoa). Tama loytyi ja korjattiin
// paikallisella testauksella ennen julkaisua.
function benjaminiHochberg(pValues, alpha = 0.05) {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, origIndex: i }));
  indexed.sort((a, b) => a.p - b.p);

  let maxSignificantRank = 0;
  for (let i = 0; i < m; i++) {
    const rank = i + 1;
    const threshold = (rank / m) * alpha;
    if (indexed[i].p <= threshold) {
      maxSignificantRank = rank;
    }
  }

  const qValues = new Array(m);
  let runningMin = 1;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const q = Math.min(runningMin, indexed[i].p * m / rank);
    runningMin = q;
    qValues[indexed[i].origIndex] = q;
  }

  const significantIndices = maxSignificantRank > 0
    ? indexed.slice(0, maxSignificantRank).map(x => x.origIndex)
    : [];

  return { qValues, significantIndices, maxSignificantRank, alpha };
}

async function handleCompareNAOSLA(url) {
  const lat = url.searchParams.get('lat') || '26.5';
  const lonWest = url.searchParams.get('lonWest') || '-75';
  const lonEast = url.searchParams.get('lonEast') || '-15';
  const days = parseInt(url.searchParams.get('days') || '365', 10);
  const maxLag = parseInt(url.searchParams.get('maxLag') || '30', 10);
  const endDate = url.searchParams.get('date') || url.searchParams.get('endDate') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);

  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - (days + maxLag) * 24 * 3600 * 1000);
  const fetchEnd = new Date(end.getTime() + maxLag * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);
  const fetchEndStr = fetchEnd.toISOString().slice(0, 10) > endDate ? endDate : fetchEnd.toISOString().slice(0, 10);

  const urlWest = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${fetchEndStr}T00:00:00Z)][(${lat})][(${lonWest})]`;
  const urlEast = `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${startStr}T00:00:00Z):(${fetchEndStr}T00:00:00Z)][(${lat})][(${lonEast})]`;
  // VAIHDETTU 2026-07-31, kayttajan oma ehdotus: NOAA CPC:n paivittainen,
  // normalisoitu NAO-indeksi (station-based) on ajantasaisempi kuin
  // aiempi PSL-lahde (joka jai ~4.5kk jalkeen). HUOM: arvot ovat ERI
  // SKAALASSA kuin aiempi PSL-versio (normalisoitu ~-2..+2 vs. raaka
  // EOF-lataus ~-400..+400) - ei vaikuta Pearson r:aan (skaalariippumaton)
  // mutta nao-arvojen suuruusluokka nayttaa erilaiselta.
  const naoUrl = 'https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii';

  try {
    const [rWest, rEast, rNAO] = await Promise.all([fetch(urlWest), fetch(urlEast), fetch(naoUrl)]);
    if (!rWest.ok) throw new Error(`Lansipiste ERDDAP HTTP ${rWest.status}`);
    if (!rEast.ok) throw new Error(`Itapiste ERDDAP HTTP ${rEast.status}`);
    if (!rNAO.ok) throw new Error(`NAO (CPC) HTTP ${rNAO.status}`);

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

    const allDates = [...gradientByDate.keys()].filter(d => d >= startStr && d <= endDate).sort();
    const gradSeries = allDates.map(d => gradientByDate.get(d));
    const naoAvailable = allDates.filter(d => naoByDate.has(d));

    function seriesAtLag(lag) {
      const xs = [], ys = [];
      for (let i = 0; i < allDates.length; i++) {
        const targetIdx = i + lag;
        if (targetIdx < 0 || targetIdx >= allDates.length) continue;
        const naoDate = allDates[i];
        if (!naoByDate.has(naoDate)) continue;
        xs.push(gradSeries[targetIdx]);
        ys.push(naoByDate.get(naoDate));
      }
      return { xs, ys };
    }

    const lag0 = seriesAtLag(0);
    if (lag0.xs.length < 10) {
      throw new Error(`Liian vahan paallekkaisia paivamaaria (${lag0.xs.length}) - NAO-data ei todennakoisesti ulotu pyydetylle valille`);
    }
    const r0 = pearsonR(lag0.xs, lag0.ys);

    let bestLag = 0, bestR = r0, bestN = lag0.xs.length;
    const lagScan = [];
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const { xs, ys } = seriesAtLag(lag);
      if (xs.length < 10) continue;
      const r = pearsonR(xs, ys);
      lagScan.push({ lag, r: Number(r.toFixed(4)), n: xs.length });
      if (Math.abs(r) > Math.abs(bestR)) {
        bestR = r; bestLag = lag; bestN = xs.length;
      }
    }

    const naoLastDate = [...naoByDate.keys()].sort().pop();
    const p0 = pValueFromR(r0, lag0.xs.length);
    const pBest = pValueFromR(bestR, bestN);

    // Kayttajan oma tulkintaohje dashboardia varten (kynnysarvot
    // annettu suoraan kayttajan viestissa 2026-07-31)
    let interpretation;
    if (Math.abs(bestR) < 0.3 || pBest > 0.05) {
      interpretation = 'SLA-signaali ei korreloi NAO:n kanssa - vaihtelu ei selity tunnetulla meteorologisella pakotteella. VARO: tama ei vahvista AMOC-tulkintaa.';
    } else if (Math.abs(bestR) > 0.4 && pBest < 0.01 && bestLag > 5) {
      interpretation = `SLA seuraa NAO:ta ${bestLag} vrk viiveella (r = ${bestR.toFixed(3)}). Tama viittaa Rossby-aaltomekanismiin, ei suoraan AMOC:n muutokseen.`;
    } else {
      interpretation = `Kohtalainen tulos (r_best=${bestR.toFixed(3)}, lag=${bestLag}, p=${pBest.toFixed(4)}) - ei tayta kummankaan ariarvon (|r|<0.3 tai |r|>0.4&p<0.01&lag>5) kriteereja selvasti.`;
    }

    return json({
      bem_e_tyylinen_komponentti: 'AMOC — ita-lansi-gradientin ja NAO:n viivekorrelaatio',
      lahde: 'NOAA CoastWatch ERDDAP (gradientti) + NOAA CPC paivittainen normalisoitu NAO (station-based)',
      kysely: { lat, lonWest, lonEast, date: endDate, days, maxLag },
      series: {
        sla_observations: allDates.length,
        nao_observations: naoAvailable.length,
        matched_points: lag0.xs.length,
        date_range: [allDates[0], allDates[allDates.length - 1]],
      },
      statistics: {
        pearson_r: Number(r0.toFixed(4)),
        r_squared: Number((r0*r0).toFixed(4)),
        p_value: p0,
        lag_0: 0,
        lag_best: bestLag,
        lag_best_r: Number(bestR.toFixed(4)),
        lag_best_p: pBest,
      },
      lag_spectrum: {
        min_lag: -maxLag,
        max_lag: maxLag,
        step: 1,
        peak_correlation: Number(bestR.toFixed(4)),
        peak_at_lag: bestLag,
        full_scan: lagScan,
      },
      interpretation,
      notes: [
        `NAO-data (CPC, paivittainen normalisoitu) paattyy paivamaaraan ${naoLastDate}`,
        'SLA on laskettu raakana ita-lansi-erona ilman kausivaihtelukorjausta (vuosienvalinen/Rossby-dominanssi loydetty aiemmin, ks. amoc-instrument-plan.md)',
        'lag>0 tarkoittaa: NAO edeltaa gradienttia - positiivinen paras-lag tukisi tuulipakote-/Rossby-aaltomekanismia',
        'p<0.05 tarkoittaa tilastollista merkitsevyytta (normaalijakauma-approksimaatio, tarkka kun n>100)',
        'Korrelaatio laskettu VAIN paallekkaisilta paivamaarilta - katso series-kentta ennen tulkintaa',
      ],
    });
  } catch (e) {
    return json({ error: e.message, step: 'compare-nao-sla' }, 502);
  }
}

// ══════════════════════════════════════════════════════════════════
// YLEINEN KAHDEN AIKASARJAN VERTAILUMOOTTORI
// ══════════════════════════════════════════════════════════════════
// LISATTY 2026-07-31, kayttajan oma arkkitehtuuriehdotus: sen sijaan
// etta /compare/nao-sla olisi ainoa, kertakayttoinen vertailu,
// rakennetaan yleinen moottori jota voi kayttaa myohemmin mihin
// tahansa sarjapariin (SLA/NAO/RAPID/SST/SMB) ilman uutta koodia.
//
// Kehitysjarjestys kayttajan oman ehdotuksen mukaisesti:
// Vaihe 1 (jo tehty): Pearson + lag +-30 vrk + yhteiset paivamaarat
// Vaihe 2 (tama paivitys): Spearman + effective N (Neff)
// Vaihe 3: taysi CCF-kayra (jo osittain: lag_spectrum.full_scan)
// Vaihe 4: RAPID mukaan kun sen aikasarja on julkaistu proxyssa

// ── Sarjatoimittajat: kukin palauttaa Map<paivamaara, arvo> ──
// LISATTY 2026-07-31: ERDDAP hylkaa pitkat yhden pisteen aikasarjakyselyt
// "Proxy Error" (502) -virheella - ERDDAP:n oma dokumentaatio vahvistaa
// taman tunnetuksi rajoitteeksi ("Requests for a long time range (>30
// time points)... often appear as Proxy Errors") ja suosittelee
// ratkaisuksi useampaa pienempaa kyselya. Havaittu kayttajan omassa
// testissa: 7289 vrk:n SST-kysely (koko RAPID-aika 2004-2024) antoi
// 502:n, kun taas 365 vrk toimi.
//
// Pilkotaan pyydetty aikavali ~350 vrk:n paloihin, haetaan rinnakkain
// (Promise.all), yhdistetaan tulokset. Testattu paikallisesti: 7290
// paivaa (2004-04-07...2024-03-22) jakautuu 21 palaan ilman aukkoja
// tai paallekkaisyyksia.
function splitDateRangeIntoChunks(startStr, endStr, chunkDays = 350) {
  const chunks = [];
  let cursor = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (chunkDays - 1) * 86400000, end.getTime()));
    chunks.push({
      start: cursor.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
  return chunks;
}

// LISATTY 2026-07-31, kayttajan oma ehdotus: kuukausittainen naytteenotto
// (yksi paiva/kk) koko monivuotisen aikavalin sijaan. Vahentaa ERDDAP:lta
// pyydettyjen pisteiden maaran murto-osaan (~240 vs ~7290 20 vuodelle) -
// ei enaa yhtaan "pitka aikavali"-kyselya, vain yksittaisia, kevyita
// yhden-paivan kyselyita. Testattu paikallisesti: 240 kuukautta 20
// vuodelle, oikea jarjestys, ei duplikaatteja.
// PAIVITETTY 2026-07-31: lisatty monthStep-parametri kayttajan omasta
// pyynnosta vahentaa naytteenottotiheytta. Syy: 240 kuukautta ylitti
// Cloudflare Workerin ILMAISEN TASON 50 alipyynnon rajan per kutsu
// (havaittu suoraan: "Too many subrequests by single Worker invocation").
// Oletus monthStep=6 (puolivuosittain) antaa ~40 nayteta 20 vuodelle -
// turvamarginaali 50:n rajaan, jattaen tilaa myos RAPID:n omalle
// yhdelle JSON-haulle samassa kutsussa. Testattu paikallisesti: 20v/6kk
// -> 40 nayteta, tasaiset 6kk:n valit.
function sampleMonthlyDates(startStr, endStr, dayOfMonth = 15, monthStep = 1) {
  const dates = [];
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (true) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(dayOfMonth, daysInMonth);
    const candidate = new Date(Date.UTC(year, month, day));
    if (candidate > end) break;
    if (candidate >= start) dates.push(candidate.toISOString().slice(0, 10));
    month += monthStep;
    while (month > 11) { month -= 12; year++; }
  }
  return dates;
}

// LISATTY 2026-07-31, kayttajan oma ehdotus: Cloudflaren oma Cache API
// -valimuisti ERDDAP-hauille. Koska historiallinen data (2004-2024) ei
// koskaan muutu, sama URL voidaan tallentaa pitkaksi aikaa - seuraavat
// vertailut samalta ajalta eivat enaa tarvitse uutta ERDDAP-kutsua
// lainkaan, mika seka nopeuttaa etta tekee analyysiputken riippumattomaksi
// NOAA:n hetkellisista hairioista (kuten juuri havaitusta 502/503-
// ongelmasta).
async function cachedFetch(url, ttlSeconds = 2592000) { // 30 vrk oletus
  const cache = caches.default;
  const cacheKey = new Request(url);
  let response = await cache.match(cacheKey);
  if (response) return response;
  response = await fetch(url);
  if (response.ok) {
    const toCache = new Response(response.body, response);
    toCache.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    await cache.put(cacheKey, toCache.clone());
    return toCache;
  }
  return response;
}

// PAIVITETTY 2026-07-31: alkuperainen versio haki KAIKKI palat
// rinnakkain (Promise.all) - tama itsessaan aiheutti uuden 502-virheen,
// koska ERDDAP:n oma dokumentaatio varoittaa etta palvelin voi
// ylikuormittua jos sita pyydetaan liian monella samanaikaisella
// kyselylla lyhyessa ajassa, vaikka jokainen yksittainen kysely olisi
// riittavan pieni. Vaihdettu rajoitettuun rinnakkaisuuteen (3 kerrallaan)
// - tasapaino nopeuden ja ERDDAP:n kuormituksen valilla. PAIVITETTY
// VIELA KERRAN: sama pala epaonnistui johdonmukaisesti myos 3
// rinnakkaisella - vahennetty taysin perakkaiseksi (BATCH_SIZE=1).
// LISATTY NYT: cachedFetch jokaiselle palalle - toistuvat kyselyt
// samalta historialliselta ajalta eivat enaa tarvitse uutta ERDDAP-
// kutsua.
async function fetchERDDAPSinglePointInChunks(buildUrl, startStr, endStr) {
  const chunks = splitDateRangeIntoChunks(startStr, endStr, 350);
  const out = new Map();
  const BATCH_SIZE = 1;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const responses = await Promise.all(batch.map(c => cachedFetch(buildUrl(c.start, c.end))));
    for (let j = 0; j < responses.length; j++) {
      const r = responses[j];
      if (!r.ok) throw new Error(`ERDDAP HTTP ${r.status} (pala ${batch[j].start}...${batch[j].end})`);
      const csv = await r.text();
      csv.trim().split('\n').slice(2).forEach(l => {
        const [time, , , v] = l.split(',');
        const val = parseFloat(v);
        if (!Number.isNaN(val)) out.set(time.slice(0, 10), val);
      });
    }
  }
  return out;
}

// LISATTY 2026-07-31: kuukausittainen versio - hakee YHDEN paivan per
// kuukausi yksittaisena, kevyena ERDDAP-kyselyna (ei aikavalia lainkaan),
// valimuistilla. Valttaa "pitka aikavali"-502-ongelman kokonaan koska
// yksikaan yksittainen kysely ei koskaan pyyda enempaa kuin 1 paivan.
async function fetchERDDAPAtDates(buildUrl, dates) {
  const out = new Map();
  const BATCH_SIZE = 3;
  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);
    const responses = await Promise.all(batch.map(d => cachedFetch(buildUrl(d, d))));
    for (let j = 0; j < responses.length; j++) {
      const r = responses[j];
      if (!r.ok) continue;
      const csv = await r.text();
      csv.trim().split('\n').slice(2).forEach(l => {
        const [time, , , v] = l.split(',');
        const val = parseFloat(v);
        if (!Number.isNaN(val)) out.set(time.slice(0, 10), val);
      });
    }
  }
  return out;
}

async function fetchERDDAPMonthlySamples(buildUrl, startStr, endStr, monthStep) {
  const dates = sampleMonthlyDates(startStr, endStr, 15, monthStep);
  return fetchERDDAPAtDates(buildUrl, dates);
}

// PAIVITETTY 2026-07-31, kayttajan oma paatos ("Vahennetaan"): 'monthly'-
// parametri tulkitaan nyt NUMEROKSI (kuukausivali), ei vain '1':ksi/
// binaariseksi lipuksi. Cloudflare Workerin ILMAISEN TASON 50 alipyynnon
// raja per kutsu havaittiin suoraan ("Too many subrequests"). SLA
// tarvitsee HARVEMMAN oletusvalin koska se hakee KAKSI pistetta
// (lansi+ita) - kaksinkertainen alipyyntomaara samalla naytemaaralla.
// Oletukset: SLA=12kk (~20 nayteta x2 pistetta = ~40 alipyyntoa),
// SST=6kk (~40 nayteta x1 piste = ~40 alipyyntoa) - molemmat
// turvamarginaalilla 50:n rajaan, jattaen tilaa RAPID:n omalle
// yhdelle JSON-haulle samassa kutsussa.
async function fetchSLASeries(startStr, endStr, params) {
  const lat = params.get('lat') || '26.5';
  const lonWest = params.get('lonWest') || '-75';
  const lonEast = params.get('lonEast') || '-15';
  const monthlyParam = params.get('monthly');
  const monthly = monthlyParam !== null;
  const monthStep = monthlyParam && monthlyParam !== '1' ? parseInt(monthlyParam, 10) : 12;
  const fetcher = monthly
    ? (buildUrl, s, e) => fetchERDDAPMonthlySamples(buildUrl, s, e, monthStep)
    : fetchERDDAPSinglePointInChunks;
  const [westMap, eastMap] = await Promise.all([
    fetcher(
      (s, e) => `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${s}T00:00:00Z):(${e}T00:00:00Z)][(${lat})][(${lonWest})]`,
      startStr, endStr),
    fetcher(
      (s, e) => `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${s}T00:00:00Z):(${e}T00:00:00Z)][(${lat})][(${lonEast})]`,
      startStr, endStr),
  ]);
  const out = new Map();
  eastMap.forEach((v, d) => { if (westMap.has(d)) out.set(d, v - westMap.get(d)); });
  return out;
}

async function fetchNAOSeries(startStr, endStr) {
  const naoUrl = 'https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii';
  const r = await fetch(naoUrl);
  if (!r.ok) throw new Error(`nao (CPC) HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d{4}\s+\d{1,2}\s+\d{1,2}\s+-?\d+\.?\d*$/.test(l));
  const out = new Map();
  lines.forEach(l => {
    const p = l.split(/\s+/);
    const d = `${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
    if (d >= startStr && d <= endStr) out.set(d, parseFloat(p[3]));
  });
  return out;
}

async function fetchSSTSeries(startStr, endStr, params) {
  const lat = params.get('sstLat') || '60';
  const lon = params.get('sstLon') || '-30';
  const monthlyParam = params.get('monthly');
  const monthly = monthlyParam !== null;
  const monthStep = monthlyParam && monthlyParam !== '1' ? parseInt(monthlyParam, 10) : 6;
  if (!monthly) return fetchERDDAPSinglePointInChunks(
    (s, e) => `https://coastwatch.noaa.gov/erddap/griddap/noaacrwsstanomalyDaily.csv?sea_surface_temperature_anomaly[(${s}T00:00:00Z):(${e}T00:00:00Z)][(${lat})][(${lon})]`,
    startStr, endStr);
  return fetchERDDAPMonthlySamples(
    (s, e) => `https://coastwatch.noaa.gov/erddap/griddap/noaacrwsstanomalyDaily.csv?sea_surface_temperature_anomaly[(${s}T00:00:00Z):(${e}T00:00:00Z)][(${lat})][(${lon})]`,
    startStr, endStr, monthStep);
}

async function fetchSMBSeries(startStr, endStr) {
  const smbUrl = 'https://download.dmi.dk/Research_Projects/polarportal/PP_GSMB/GSMB.txt';
  const r = await fetch(smbUrl);
  if (!r.ok) throw new Error(`smb (DMI) HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d{8}\s+-?\d+\.?\d*\s+-?\d+\.?\d*$/.test(l));
  const out = new Map();
  lines.forEach(l => {
    const [dateStr, smb] = l.split(/\s+/);
    const d = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
    if (d >= startStr && d <= endStr) out.set(d, parseFloat(smb));
  });
  return out;
}

// LISATTY 2026-07-31, kayttajan pyynnosta korjata SMB-RAPID-vertailun
// aikaikkunaongelma: DMI:n GSMB.txt kattaa vain nykyisen sulamiskauden
// (~2025-syyskuusta alkaen), ei ulotu RAPID:n historialliselle ajalle
// (2004-2024) lainkaan - "0 paallekkaista paivamaaraa" ei siis ollut
// korjattava kyselyparametri vaan aito, rakenteellinen aikaikkunoiden
// paallekkaisyyden puute.
//
// LOYDETTY PAREMPI, PIDEMPI LAHDE: GEUS/PROMICE-massatase (Mankoff ym.
// 2021, "1840-nykyhetki"), thredds.geus.dk. Paivittainen, 1986-alkaen -
// ULOTTUU RAPID:n koko 2004-2024-ajalle. LISAKSI tama on KOKONAIS-
// massatase (sisaltaa jaatikoiden kalvamisen/discharge), ei vain
// DMI:n pintamassatase - tasmalleen se suure jota alunperin
// tavoittelimme (ks. aiempi HEM/BEM-E-keskustelu GRACE:sta).
//
// CSV-tiedosto antaa KUMULATIIVISEN tason (MB_cumulative), ei
// paivittaista nopeutta - lasketaan paivittainen ERO peratkaisten
// rivien valilla jotta suure on vertailukelpoinen DMI:n SMB-sarjan
// (Gt/vrk) kanssa. Testattu paikallisesti synteettisella naytteella.
async function fetchGMBSeries(startStr, endStr) {
  const gmbUrl = 'https://thredds.geus.dk/thredds/fileServer/MassBalance/MB_cumulative.csv';
  const r = await fetch(gmbUrl);
  if (!r.ok) throw new Error(`gmb (GEUS/PROMICE) HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split('\n').slice(1); // ohita otsikkorivi
  const rows = [];
  for (const l of lines) {
    const parts = l.split(',');
    const date = parts[0];
    const cum = parseFloat(parts[1]);
    if (!Number.isNaN(cum)) rows.push({ date, cumulative: cum });
  }
  const out = new Map();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date >= startStr && rows[i].date <= endStr) {
      out.set(rows[i].date, rows[i].cumulative - rows[i-1].cumulative);
    }
  }
  return out;
}

// VAIHE 4 TOTEUTETTU 2026-07-31: RAPID:n oma moc_transports.nc
// (kayttajan lataama BODC:lta, ks. amoc-instrument-plan.md) muunnettiin
// paikallisesti Python/netCDF4-kirjastolla kompaktiksi paivittaiseksi
// JSON:iksi (7290 paivaa, 2004-04-07...2024-03-22, paivakeskiarvot 12h-
// resoluutiosta) ja julkaistiin staattisena tiedostona aethercontinuity.
// org:iin - Cloudflare Worker EI voi parsia alkuperaista NetCDF/HDF5-
// binaarimuotoa suoraan, mutta voi hakea taman jo-esikasitellyn JSON:in
// tavallisella fetch()+json()-kutsulla.
//
// NELJA KOMPONENTTIA rekisteroity ERILLISINA sarjoina (rapid_moc,
// rapid_umo, rapid_gs, rapid_ek) koska /compare-moottori odottaa yhta
// arvoa per paiva per sarja, ei moniulotteista objektia. rapid_umo on
// erityisen kiinnostava - se on TASMALLEEN se suure jota oma karkea
// SLA-gradienttimme yritti approksimoida (ks. aiempi suora validointi-
// testi, r=0.339 lag+10:lla, RAAKALLA N:lla laskettuna ennen Neff-
// korjausta - talla /compare-moottorilla voi nyt toistaa saman testin
// Neff-korjattuna).
async function fetchRAPIDComponentSeries(startStr, endStr, component) {
  const url = 'https://aethercontinuity.org/tools/rapid_daily.json';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`rapid_daily.json HTTP ${r.status}`);
  const data = await r.json();
  const out = new Map();
  for (const [date, vals] of Object.entries(data)) {
    if (date >= startStr && date <= endStr && vals[component] !== null && vals[component] !== undefined) {
      out.set(date, vals[component]);
    }
  }
  return out;
}

const SERIES_PROVIDERS = {
  sla: fetchSLASeries,
  nao: (s, e, p) => fetchNAOSeries(s, e),
  sst: fetchSSTSeries,
  smb: (s, e) => fetchSMBSeries(s, e),
  gmb: (s, e) => fetchGMBSeries(s, e),
  rapid_moc: (s, e) => fetchRAPIDComponentSeries(s, e, 'moc'),
  rapid_umo: (s, e) => fetchRAPIDComponentSeries(s, e, 'umo'),
  rapid_gs: (s, e) => fetchRAPIDComponentSeries(s, e, 'gs'),
  rapid_ek: (s, e) => fetchRAPIDComponentSeries(s, e, 'ek'),
};

// LISATTY 2026-07-31, kayttajan oma ehdotus: metadata jokaiselle
// sarjalle (lahde, yksikko) - helpottaa yllapitoa kun RAPID/SST/SMB
// -parien maara kasvaa.
const SERIES_METADATA = {
  sla: { source: 'NOAA CoastWatch ERDDAP (noaacwBLENDEDsshDaily)', units: 'm (ita-lansi-ero, 26.5N)' },
  nao: { source: 'NOAA CPC (paivittainen normalisoitu, station-based)', units: 'index (normalisoitu)' },
  sst: { source: 'NOAA ERDDAP (noaacrwsstanomalyDaily)', units: 'degree_C (anomalia)' },
  smb: { source: 'DMI Polar Portal (HARMONIE-AROME)', units: 'Gt/vrk (pintamassatase, vain nykyinen sulamiskausi)' },
  gmb: { source: 'GEUS/PROMICE (Mankoff ym. 2021), thredds.geus.dk', units: 'Gt/vrk (kokonaismassatase, 1986-nykyhetki, sisaltaa kalvamisen)' },
  rapid_moc: { source: 'RAPID v2024.1a (esikasitelty, 2004-04-07...2024-03-22, ei live)', units: 'Sv (kokonaiskuljetus)' },
  rapid_umo: { source: 'RAPID v2024.1a (esikasitelty, 2004-04-07...2024-03-22, ei live)', units: 'Sv (ylakeskiokeaanin kuljetus)' },
  rapid_gs: { source: 'RAPID v2024.1a (esikasitelty, 2004-04-07...2024-03-22, ei live)', units: 'Sv (Florida-salmi/Golfvirta)' },
  rapid_ek: { source: 'RAPID v2024.1a (esikasitelty, 2004-04-07...2024-03-22, ei live)', units: 'Sv (Ekman-kuljetus)' },
};


// ── Tilastofunktiot: Spearman + effective N (autokorrelaatiokorjattu) ──
function ranks(arr) {
  const idx = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j+1]] === arr[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avgRank;
    i = j + 1;
  }
  return r;
}
function spearmanRho(xs, ys) {
  return pearsonR(ranks(xs), ranks(ys));
}
// Effective sample size autokorreloiduille aikasarjoille (Bretherton
// ym. 1999 -tyylinen approksimaatio): Neff = N*(1-r1x*r1y)/(1+r1x*r1y).
// Molemmat NAO ja SLA ovat ajallisesti autokorreloituneita (vahvistettu
// aiemmin: Rossby-aallot etenevat hitaasti) - tavallinen Pearsonin
// p-arvo N:lla olisi liian optimistinen (nayttaisi merkitsevammalta
// kuin todellisuudessa on).
//
// PAIVITETTY 2026-07-31, kayttajan oma tekninen huomio: alkuperainen
// versio kaytti vain LAG-1-autokorrelaatiota, mutta ilmastoaikasarjoissa
// autokorrelaatio ulottuu usein useille viiveille. Pyper & Peterman
// (1998) -alkuperaisessa menetelmassa kaytetaan koko ACF:aa:
//   Neff = N / (1 + 2*sum_{k=1}^{m} rho_x(k)*rho_y(k))
// Katkaisuraja m = min(N/5, 30) (yleinen nyrkkisaanto, valttaa kohinaa
// korkeilta viiveilta joissa autokorrelaatioestimaatti on epaluotettava
// pienesta jaljella olevasta otoksesta).
function autocorrAtLag(series, k) {
  if (k >= series.length - 2) return 0;
  return pearsonR(series.slice(0, -k), series.slice(k));
}
function effectiveN(xs, ys) {
  const n = xs.length;
  const m = Math.min(Math.floor(n / 5), 30);
  let sum = 0;
  for (let k = 1; k <= m; k++) {
    sum += autocorrAtLag(xs, k) * autocorrAtLag(ys, k);
  }
  const denom = 1 + 2 * sum;
  const raw = denom > 0 ? n / denom : n;
  // Sailytetaan myos lag-1-arvot omana kenttanaan - yhteensopivuus ja
  // luettavuus (helpompi tulkita yhta lukua kuin koko ACF-summaa)
  const r1x = autocorrAtLag(xs, 1), r1y = autocorrAtLag(ys, 1);
  return {
    neff: Math.max(2, Math.min(n, raw)),
    r1x: Number(r1x.toFixed(3)),
    r1y: Number(r1y.toFixed(3)),
    acf_lags_used: m,
    acf_sum: Number(sum.toFixed(4)),
  };
}

// LISATTY 2026-07-31, kayttajan oma ehdotus (mekanistinen validointi,
// Vaihe 1 - suodatustestit): jos SST-RAPID_MOC-korrelaatio (r=0.525,
// lag=-11) katoaa kun molemmat sarjat tasoitetaan liukuvalla
// keskiarvolla (30/60/90 vrk), kyseessa on korkeataajuinen (saa-
// asteikon) ilmio, ei hidas valtamerivaste - erottaa kaksi
// kilpailevaa fysikaalista tulkintaa suoralla testilla.
//
// Trailing-ikkuna (nykyinen paiva + edeltavat windowDays-1 paivaa).
// Vaatii vahintaan puolet ikkunan pituudesta jotta reuna-artefaktit
// (ikkunan alku/loppu, missa data on vajaata) valtetaan. Testattu
// paikallisesti: vakioarvo pysyy samana, askelfunktion siirtyma
// tasoittuu oikein asteittain.
function applyMovingAverage(dateValueMap, windowDays) {
  if (!windowDays || windowDays < 2) return dateValueMap;
  const dates = [...dateValueMap.keys()].sort();
  const out = new Map();
  for (let i = 0; i < dates.length; i++) {
    const windowStart = new Date(dates[i] + 'T00:00:00Z').getTime() - (windowDays - 1) * 86400000;
    const windowVals = [];
    for (let j = i; j >= 0; j--) {
      const dj = new Date(dates[j] + 'T00:00:00Z').getTime();
      if (dj < windowStart) break;
      windowVals.push(dateValueMap.get(dates[j]));
    }
    if (windowVals.length >= Math.ceil(windowDays / 2)) {
      out.set(dates[i], windowVals.reduce((a,b)=>a+b,0) / windowVals.length);
    }
  }
  return out;
}

// Sarjat jotka eivat tarvitse ERDDAP-hakua (halpoja, koko range voidaan
// hakea kerralla ja poimia tarvittavat paivat jalkikateen)
const CHEAP_SERIES = new Set(['nao', 'smb', 'gmb', 'rapid_moc', 'rapid_umo', 'rapid_gs', 'rapid_ek']);

function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return new Date(d.getTime() + deltaDays * 86400000).toISOString().slice(0, 10);
}

// Hakee YHDEN sarjan arvot TASMALLEEN annetuille paivamaarille (ei
// jatkuvalle valille). "Halvat" sarjat: hae koko kattava range kerran,
// poimi sitten pyydetyt paivat. "Kalliit" (ERDDAP) sarjat: hae jokainen
// pyydetty paiva erikseen omana yksittaispisteen kyselynaan.
async function fetchSeriesAtExactDates(seriesName, dates, params) {
  if (CHEAP_SERIES.has(seriesName)) {
    const minD = dates.reduce((a,b) => a < b ? a : b);
    const maxD = dates.reduce((a,b) => a > b ? a : b);
    const fullMap = await SERIES_PROVIDERS[seriesName](minD, maxD, params);
    const out = new Map();
    dates.forEach(d => { if (fullMap.has(d)) out.set(d, fullMap.get(d)); });
    return out;
  }
  if (seriesName === 'sst') {
    const lat = params.get('sstLat') || '60';
    const lon = params.get('sstLon') || '-30';
    return fetchERDDAPAtDates(
      (s) => `https://coastwatch.noaa.gov/erddap/griddap/noaacrwsstanomalyDaily.csv?sea_surface_temperature_anomaly[(${s}T00:00:00Z):(${s}T00:00:00Z)][(${lat})][(${lon})]`,
      dates);
  }
  if (seriesName === 'sla') {
    const lat = params.get('lat') || '26.5';
    const lonWest = params.get('lonWest') || '-75';
    const lonEast = params.get('lonEast') || '-15';
    const [westMap, eastMap] = await Promise.all([
      fetchERDDAPAtDates((s) => `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${s}T00:00:00Z):(${s}T00:00:00Z)][(${lat})][(${lonWest})]`, dates),
      fetchERDDAPAtDates((s) => `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.csv?sla[(${s}T00:00:00Z):(${s}T00:00:00Z)][(${lat})][(${lonEast})]`, dates),
    ]);
    const out = new Map();
    eastMap.forEach((v, d) => { if (westMap.has(d)) out.set(d, v - westMap.get(d)); });
    return out;
  }
  throw new Error(`fixedLag-tila ei tue sarjaa: ${seriesName}`);
}

// LISATTY 2026-07-31: testaa YHTA tiettya, ennalta tunnettua paivatason
// viivetta (esim. -11 vrk) koko pitkalla aikavalilla harvalla, halvalla
// naytteenotolla. Ratkaisee sen dimensionaalisen ongelman joka syntyi
// kun kuukausittaista naytteenottoa yritettiin kayttaa 61 viiveen
// indeksipohjaisen skannauksen kanssa (viive 1 tarkoitti kuukausia,
// ei paivaa). Tassa siirto tehdaan KALENTERIPAIVINA hakuvaiheessa, ei
// jalkikateen indeksipaikkoina.
async function handleCompareFixedLag(url, seriesA, seriesB, endDate, days, fixedLag) {
  const monthStep = parseInt(url.searchParams.get('monthly') || '12', 10); // PAIVITETTY: 6->12 (vuosittain, ~20 nayteta 20v) - 6 (40 nayteta) osui viela alipyyntorajaan
  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);

  try {
    const anchorDates = sampleMonthlyDates(startStr, endDate, 15, monthStep);
    // series_b haetaan ankkuripaivina sellaisenaan; series_a haetaan
    // ankkuri+fixedLag -siirrettyina paivina (lag>0 = B edeltaa A:ta,
    // sama etumerkkikonventio kuin paaskannauksessa)
    const datesB = anchorDates;
    const datesA = anchorDates.map(d => shiftDate(d, fixedLag));

    const [mapA, mapB] = await Promise.all([
      fetchSeriesAtExactDates(seriesA, datesA, url.searchParams),
      fetchSeriesAtExactDates(seriesB, datesB, url.searchParams),
    ]);

    const xs = [], ys = [], pairedDates = [];
    for (let i = 0; i < anchorDates.length; i++) {
      if (mapA.has(datesA[i]) && mapB.has(datesB[i])) {
        xs.push(mapA.get(datesA[i]));
        ys.push(mapB.get(datesB[i]));
        pairedDates.push({ anchor: anchorDates[i], dateA: datesA[i], dateB: datesB[i] });
      }
    }

    if (xs.length < 5) {
      throw new Error(`Liian vahan paallekkaisia pisteita (${xs.length}) - tarkista etta molempien sarjojen data ulottuu pyydetylle valille`);
    }

    const r = pearsonR(xs, ys);
    const rho = spearmanRho(xs, ys);
    const { neff, r1x, r1y, acf_lags_used, acf_sum } = effectiveN(xs, ys);
    const pVal = pValueFromR(r, neff);

    return json({
      bem_e_tyylinen_komponentti: `AMOC — kiintean viiveen pitkan aikavalin testi: ${seriesA} vs ${seriesB}`,
      lahde: 'ACI yleinen kahden aikasarjan vertailumoottori (fixedLag-tila)',
      kysely: { series_a: seriesA, series_b: seriesB, date: endDate, days, fixedLag, monthStep },
      huom_menetelmasta: 'Tama tila testaa YHTA ennalta valittua paivatason viivetta harvalla (kuukausittaisella) naytteenotolla koko pitkan aikavalin yli - EI 61 viiveen skannausta. Sarjan A hakupaivamaaria siirretaan KALENTERIPAIVINA (fixedLag vrk) ennen hakua, ei indeksipaikkoina jalkikateen - talla valtetaan dimensionaalinen virhe joka syntyisi jos harvaa naytetta yritettaisiin skannata paivatason viiveilla.',
      series: {
        anchor_points: anchorDates.length,
        matched_points: xs.length,
        date_range: [anchorDates[0], anchorDates[anchorDates.length - 1]],
      },
      statistics: {
        pearson_r: Number(r.toFixed(4)),
        spearman_rho: Number(rho.toFixed(4)),
        r_squared: Number((r*r).toFixed(4)),
        effective_n: Number(neff.toFixed(1)),
        raw_n: xs.length,
        lag1_autocorr_a: r1x,
        lag1_autocorr_b: r1y,
        p_value: pVal,
        fixed_lag_days: fixedLag,
      },
      naytepisteet: pairedDates.slice(0, 5).concat(pairedDates.length > 10 ? ['...'] : []).concat(pairedDates.slice(-3)),
      notes: [
        `Testattu KIINTEA viive ${fixedLag} vrk, ei skannausta - jos haluat skannata eri viiveita, aja tama useita kertoja eri fixedLag-arvoilla (esim. -11, -10, -12) ja vertaa r-arvoja kasin.`,
        `p-arvo laskettu Neff:lla (${neff.toFixed(1)}), ei raa'alla N:lla (${xs.length})`,
        `Ankkuripisteita ${anchorDates.length} (monthStep=${monthStep}), tama pitaa alipyyntomaaran alle Cloudflaren 50:n rajan`,
      ],
    });
  } catch (e) {
    return json({ error: e.message, step: 'compare-fixed-lag', series_a: seriesA, series_b: seriesB }, 502);
  }
}

async function handleCompare(url) {
  const seriesA = url.searchParams.get('series_a');
  const seriesB = url.searchParams.get('series_b');
  const days = parseInt(url.searchParams.get('days') || '365', 10);
  const maxLag = parseInt(url.searchParams.get('lag') || url.searchParams.get('maxLag') || '30', 10);
  const smooth = parseInt(url.searchParams.get('smooth') || '0', 10); // LISATTY: liukuva keskiarvo (vrk), 0=ei suodatusta
  const endDate = url.searchParams.get('date') || new Date(Date.now() - 3*24*3600*1000).toISOString().slice(0, 10);
  // LISATTY 2026-07-31, kayttajan oma jatkokehitys: kun kuukausittainen
  // naytteenotto paljasti etta indeksipohjainen lag-skannaus ei tee
  // dimensionaalisesti mitaan jarkea harvalla otannalla (viive 1 =
  // 24kk, ei 1 paiva) - LISATTY erillinen, kiinteän viiveen testitila.
  // Testaa YHTA tiettya, jo tunnettua paivatason viivetta (esim. -11)
  // KOKO pitkalla aikavalilla harvalla naytteenotolla, siirtamalla
  // toisen sarjan hakupaivamaaria KALENTERIPAIVINA, ei indeksipaikkoina.
  const fixedLag = url.searchParams.get('fixedLag') !== null ? parseInt(url.searchParams.get('fixedLag'), 10) : null;

  if (!seriesA || !seriesB) {
    return json({ error: 'series_a ja series_b ovat pakollisia parametreja', saatavilla: Object.keys(SERIES_PROVIDERS) }, 400);
  }
  if (!SERIES_PROVIDERS[seriesA] || !SERIES_PROVIDERS[seriesB]) {
    return json({ error: `Tuntematon sarja: ${!SERIES_PROVIDERS[seriesA] ? seriesA : seriesB}`, saatavilla: Object.keys(SERIES_PROVIDERS) }, 400);
  }

  if (fixedLag !== null) {
    return handleCompareFixedLag(url, seriesA, seriesB, endDate, days, fixedLag);
  }

  const end = new Date(endDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - (days + maxLag) * 24 * 3600 * 1000);
  const fetchEndDate = new Date(end.getTime() + maxLag * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);
  const fetchEndStr = fetchEndDate.toISOString().slice(0, 10) > endDate ? endDate : fetchEndDate.toISOString().slice(0, 10);

  try {
    let [mapA, mapB] = await Promise.all([
      SERIES_PROVIDERS[seriesA](startStr, fetchEndStr, url.searchParams),
      SERIES_PROVIDERS[seriesB](startStr, fetchEndStr, url.searchParams),
    ]);

    if (smooth >= 2) {
      mapA = applyMovingAverage(mapA, smooth);
      mapB = applyMovingAverage(mapB, smooth);
    }

    const allDates = [...mapA.keys()].filter(d => d >= startStr && d <= endDate).sort();
    const seriesAVals = allDates.map(d => mapA.get(d));
    const bAvailable = allDates.filter(d => mapB.has(d));

    function seriesAtLag(lag) {
      const xs = [], ys = [];
      for (let i = 0; i < allDates.length; i++) {
        const targetIdx = i + lag;
        if (targetIdx < 0 || targetIdx >= allDates.length) continue;
        const dateB = allDates[i];
        if (!mapB.has(dateB)) continue;
        xs.push(seriesAVals[targetIdx]);
        ys.push(mapB.get(dateB));
      }
      return { xs, ys };
    }

    const lag0 = seriesAtLag(0);
    if (lag0.xs.length < 10) {
      throw new Error(`Liian vahan paallekkaisia paivamaaria (${lag0.xs.length}) - tarkista etta molempien sarjojen data ulottuu pyydetylle valille`);
    }
    const r0 = pearsonR(lag0.xs, lag0.ys);
    const rho0 = spearmanRho(lag0.xs, lag0.ys);
    const { neff, r1x, r1y, acf_lags_used, acf_sum } = effectiveN(lag0.xs, lag0.ys);

    let bestLag = 0, bestR = r0, bestN = lag0.xs.length;
    const lagScan = [];
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const { xs, ys } = seriesAtLag(lag);
      if (xs.length < 10) continue;
      const r = pearsonR(xs, ys);
      lagScan.push({ lag, r: Number(r.toFixed(4)), n: xs.length });
      if (Math.abs(r) > Math.abs(bestR)) { bestR = r; bestLag = lag; bestN = xs.length; }
    }

    // BENJAMINI-HOCHBERG FDR-KORJAUS, LISATTY 2026-07-31 (kayttajan
    // oma ehdotus): lasketaan p-arvo JOKAISELLE testatulle viiveelle
    // (sama neff-arvio kaikille - karkea mutta johdonmukainen
    // approksimaatio), sovelletaan BH-menetelma nakemaan selviytyyko
    // yksikaan viive monivertailukorjauksen jalkeen.
    const lagPValues = lagScan.map(entry => pValueFromR(entry.r, neff));
    const bh = benjaminiHochberg(lagPValues, 0.05);
    const bhSignificantLags = bh.significantIndices.map(idx => lagScan[idx].lag).sort((a,b)=>a-b);
    lagScan.forEach((entry, idx) => { entry.p_value = lagPValues[idx]; entry.bh_q_value = Number(bh.qValues[idx].toFixed(4)); });

    // p-arvo lasketaan Neff:lla, ei raa'alla N:lla - kayttajan oma
    // huomio: molemmat sarjat autokorreloituneita, tavallinen N
    // yliarvioisi tilastollisen merkitsevyyden
    const pValueNeff = pValueFromR(r0, neff);
    const pValueBestNeff = pValueFromR(bestR, neff); // sama neff-arvio koko ikkunalle, karkea approksimaatio eri lag:eille

    let interpretation;
    if (Math.abs(bestR) < 0.3 || pValueBestNeff > 0.05) {
      interpretation = `${seriesA}-signaali ei korreloi ${seriesB}:n kanssa (Neff-korjattu p-arvo huomioitu) - vaihtelu ei selity tunnetulla mekanismilla talla otoksella.`;
    } else if (Math.abs(bestR) > 0.4 && pValueBestNeff < 0.01 && bestLag > 5) {
      interpretation = `${seriesA} seuraa ${seriesB}:ta ${bestLag} vrk viiveella (r=${bestR.toFixed(3)}, Neff=${neff.toFixed(0)}) - viittaa hitaasti etenevaan fysikaaliseen mekanismiin (esim. Rossby-aalto), ei valittomaan yhteyteen.`;
    } else {
      interpretation = `Kohtalainen tulos (r_best=${bestR.toFixed(3)}, lag=${bestLag}, Neff=${neff.toFixed(0)}, p=${pValueBestNeff.toFixed(4)}) - ei tayta selkeasti kumpaakaan ariarvon kategoriaa.`;
    }

    return json({
      bem_e_tyylinen_komponentti: `AMOC — yleinen sarjavertailu: ${seriesA} vs ${seriesB}`,
      lahde: 'ACI yleinen kahden aikasarjan vertailumoottori',
      kysely: { series_a: seriesA, series_b: seriesB, date: endDate, days, maxLag, smooth: smooth || null },
      metadata: {
        series_a: { name: seriesA, ...(SERIES_METADATA[seriesA] || {}) },
        series_b: { name: seriesB, ...(SERIES_METADATA[seriesB] || {}) },
      },
      series: {
        [`${seriesA}_observations`]: allDates.length,
        [`${seriesB}_observations`]: bAvailable.length,
        matched_points: lag0.xs.length,
        date_range: [allDates[0], allDates[allDates.length - 1]],
      },
      statistics: {
        pearson_r: Number(r0.toFixed(4)),
        spearman_rho: Number(rho0.toFixed(4)),
        r_squared: Number((r0*r0).toFixed(4)),
        effective_n: Number(neff.toFixed(1)),
        raw_n: lag0.xs.length,
        lag1_autocorr_a: r1x,
        lag1_autocorr_b: r1y,
        acf_lags_used_in_neff: acf_lags_used,
        p_value: pValueNeff,
        lag_0: 0,
        lag_best: bestLag,
        lag_best_r: Number(bestR.toFixed(4)),
        lag_best_p: pValueBestNeff,
      },
      lag_spectrum: {
        min_lag: -maxLag, max_lag: maxLag, step: 1,
        n_lags_tested: lagScan.length,
        peak_correlation: Number(bestR.toFixed(4)), peak_at_lag: bestLag,
        full_scan: lagScan,
      },
      fdr_correction: {
        method: 'Benjamini-Hochberg (1995)',
        alpha: 0.05,
        n_tests: lagScan.length,
        n_significant_after_correction: bhSignificantLags.length,
        significant_lags: bhSignificantLags,
      },
      interpretation,
      notes: [
        bhSignificantLags.length > 0
          ? `BH-korjauksen (FDR, alpha=0.05) jalkeen ${bhSignificantLags.length}/${lagScan.length} viivetta pysyy merkitsevana: ${bhSignificantLags.join(', ')}`
          : `BH-korjauksen (FDR, alpha=0.05) jalkeen EI YKSIKAAN ${lagScan.length} testatusta viiveesta ole merkitseva - myos "paras loydetty" r saattoi olla vain monivertailun aiheuttamaa satunnaista ylikorostumista.`,
        `Paras lag (${bestLag}) valittu ${lagScan.length} testatusta viiveesta - katso fdr_correction selvittaaksesi kestaako tama monivertailukorjauksen.`,
        `Effective N laskettu taydella ACF:lla (Pyper & Peterman 1998 -tyylinen, ${acf_lags_used} viivetta huomioitu, ei vain lag-1) - ACF-summa=${acf_sum}`,
        `p-arvo laskettu EFFECTIVE N:lla (${neff.toFixed(0)}), ei raa'alla N:lla (${lag0.xs.length}) - molemmat sarjat autokorreloituneita (lag-1: ${r1x}/${r1y}), tavallinen p-arvo olisi liian optimistinen`,
        'Spearman rho tunnistaa monotonisen yhteyden vaikka Pearson (lineaarinen) olisi heikko - vertaa molempia',
        'lag>0 tarkoittaa: series_b edeltaa series_a:ta',
        `Saatavilla olevat sarjat: ${Object.keys(SERIES_PROVIDERS).join(', ')} - HUOM: rapid_* -sarjat ulottuvat vain 2004-04-07...2024-03-22 (ei live), muut sarjat voivat siis olla paallekkain vain osittain jos endDate on tuo ajanjakso ohi`,
      ],
    });
  } catch (e) {
    return json({ error: e.message, step: 'compare', series_a: seriesA, series_b: seriesB }, 502);
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
      } else if (path === '/compare/nao-sla') {
        return await handleCompareNAOSLA(url);
      } else if (path === '/compare') {
        return await handleCompare(url);
      }
      return json({ error: `Unknown route: ${path}` }, 404);
    } catch (e) {
      return json({ error: e.message, step: 'top-level' }, 500);
    }
  },
};
