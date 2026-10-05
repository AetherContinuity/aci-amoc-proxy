# aci-amoc-proxy

Cloudflare Worker — datalahteet ACI:n AMOC Endurance/Continuity -instrumentille.

Ei API-avaimia. Suunnitelma ja kehityshistoria:
https://aethercontinuity.org/tools/amoc-instrument-plan.md

## Reitit

- `/status` — proxyn tila ja reittiluettelo
- `/sla`, `/sla-gradient`, `/sla-gradient-mean`, `/sla-gradient-anomaly` — merenpinnan korkeus, NOAA CoastWatch ERDDAP (`noaacwBLENDEDsshDaily`)
- `/sst-anomaly?lat=&lon=&date=` — SST-anomalia, NOAA Coral Reef Watch (`noaacrwsstanomalyDaily`; ei OISST)
- `/rapid-info` — RAPID 26.5N viitetilastot 2004–2024 (staattinen)
- `/greenland-smb` — pintamassatase, DMI Polar Portal (massatasevuosi alkaa 1.9.)
- `/greenland-gmb` — kokonaismassatase, GEUS/PROMICE; lahteen ennusterivit ohitetaan
- `/nao` — NAO-indeksi
- `/compare?series_a=&series_b=&date=&days=` — kahden sarjan vertailu: Pearson, Spearman, effective N, lag-spektri, Benjamini-Hochberg
- `/series?name=&start=&end=[&chunk=]` — yhden sarjan raaka-arvot ilman tilastoja; pitkat analyysit ajetaan Workerin ulkopuolella

Sarjat: `sla`, `nao`, `sst`, `smb`, `gmb`, `rapid_moc`, `rapid_umo`, `rapid_gs`, `rapid_ek`.
RAPID-sarjat paattyvat 22.3.2024.

## Tunnetut rajoitteet

- Cloudflaren ilmaisen tason 50 alipyynnon raja per kutsu. `/series` rajaa ERDDAP-palat 20:een.
- ERDDAP palauttaa 502 pitkille aikavaleille (mitattu 5.10.2026: 90 vrk hylataan, 30 vrk menee lapi). `/compare` ja `/series` hakevat 30 vrk:n paloissa perakkain; `/series` raportoi epaonnistuneet palat.
- `/compare` ei poista kausisyklia. Yhden ikkunan tulos on hypoteesi, ei validointi.
- p-arvot lasketaan t-jakaumasta (df = Neff − 2) 5.10.2026 alkaen. Sita ennen kaytettiin normaaliapproksimaatiota, joka antoi pienella Neff:lla 2–3 kertaa liian pienia p-arvoja.

## Testit

    node test/test.mjs

Ei verkkoa; `fetch` on mockattu.
