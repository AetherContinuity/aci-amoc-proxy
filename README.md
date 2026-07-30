# aci-amoc-proxy

Cloudflare Worker — datalahteet ACI:n AMOC Endurance/Continuity -instrumentille.

Ei API-avaimia tarvita. Kaikki nelja datalahdetta (RAPID, NOAA ERDDAP
merenpinnan korkeudelle ja lampotila-anomalialle, ESA/TU Dresden
Gronlannin jaamassalle) vahvistettu avoimiksi 2026-07-30.

Suunnitelma: https://aethercontinuity.org/tools/amoc-instrument-plan.md

## Reitit

- `/status` — proxyn tila ja reittiluettelo
- `/sla?lat=...&lon=...&date=YYYY-MM-DD` — merenpinnan korkeuspoikkeama
- `/sst-anomaly?lat=...&lon=...&date=YYYY-MM-DD` — lampotila-anomalia
- `/rapid-info` — RAPID-taulukon viitetiedot (ei viela itse dataa)
