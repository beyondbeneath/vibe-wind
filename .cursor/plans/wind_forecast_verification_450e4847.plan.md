---
name: Wind Forecast Verification
overview: Build a polished local React/FastAPI application backed by DuckDB, with reproducible BOM observation and model-forecast ingestion plus statistically sound wind verification. The first version will backfill any freely available BOM hourly wind observations, accumulate BOM half-hourly observations and all four forecast models going forward, and support later import of an official BOM ADAM extract for multi-year overlap.
todos:
  - id: scaffold
    content: Scaffold the Python/FastAPI, DuckDB, and React/TypeScript application with documented local commands.
    status: pending
  - id: pipeline
    content: Implement idempotent BOM, Open-Meteo, ACCESS-C, and ADAM-import pipelines with provenance and coverage tracking.
    status: pending
  - id: metrics-api
    content: Implement forecast/observation matching, wind verification metrics, aggregate materialization, and API endpoints.
    status: pending
  - id: dashboard
    content: Build overview, lead-time, conditions, granular explorer, and methodology/data-health views.
    status: pending
  - id: verify
    content: Add automated tests, run real-data smoke ingestion, and verify the complete local workflow.
    status: pending
isProject: false
---

# Wind Forecast Verification App

## Data constraints and policy
- Treat BOM stations 058198 (Ballina Airport AWS) and 058216 (Cape Byron AWS) as the only observation truth, preserving source/QC metadata and UTC timestamps.
- Clearly display source coverage and sample counts. BOM’s free half-hourly feed has only a rolling 72-hour history; older half-hourly/one-minute records require an ADAM data request. Include an importer and request instructions rather than silently substituting reanalysis.
- Use Open-Meteo’s archived previous-run interface for fixed 1–7 day lead snapshots of ECMWF, GFS, and ICON where available, while archiving fresh model runs locally from day one. Fetch ACCESS-C BN 10 m `u10`/`v10` from BOM’s IDY25402/IDY25422 data and retain its true +36/+42-hour horizon; mark longer lead cells unavailable rather than compare unlike models.
- Seed the app with a small, reproducibly fetched real-data window. Add an optional extractor for the public BOM 2017–2018 verification archive if its station files are accessible, but do not represent that non-overlapping period as model skill.

## Application architecture
- Create [README.md](README.md), [Makefile](Makefile), and [.env.example](.env.example) with one-command setup, ingestion, API, UI, tests, source attribution, and BOM archive-request instructions.
- Build a Python service under [backend/app](backend/app): FastAPI routes, Pydantic contracts, DuckDB/Parquet storage, station/model registry, and a migration/bootstrap layer.
- Build ingestion adapters under [backend/app/ingest](backend/app/ingest) for BOM 72-hour observations, BOM ADAM CSV/ZIP imports, Open-Meteo fixed-lead archives/current runs, and ACCESS-C BN NetCDF/GRIB point extraction. Make every import idempotent and retain provider, model cycle, issue time, valid time, lead hours, grid point, units, and quality flags.
- Add the verification engine under [backend/app/analysis](backend/app/analysis), joining observations to forecasts at the nearest valid observation within a documented tolerance and materializing aggregates for responsive filtering.
- Create a Vite React/TypeScript UI under [frontend/src](frontend/src) using TanStack Query and ECharts, with a clean responsive desktop/mobile design.

## Analysis and product views
- Overview: best model by location and common lead window, speed MAE/RMSE/bias, circular direction MAE, vector RMSE, persistence-skill score, coverage, and confidence/sample-size warnings.
- Lead-time view: error curves and ranked comparisons by exact lead and 1d/2d/3d/7d buckets; ACCESS-C ends at its real horizon.
- Conditions view: accuracy by observed speed bins, direction sectors, hour of day, month/season, and location, including wind-rose-style summaries.
- Explorer: observed versus forecast time series, vector/direction display, issue and valid timestamps, sortable granular records, pagination, and CSV export.
- Methodology/data-health view: station metadata, source licences, model resolution/horizon, ingestion freshness, missingness, QC exclusions, model-version caveats, and metric definitions.
- Handle direction as circular data; compute wind vectors from `u/v`; suppress standalone direction scoring for calm observations using a documented configurable threshold; always show paired sample counts so rankings are honest.

## Verification
- Add fixtures and unit tests in [backend/tests](backend/tests) for circular angles, vector conversion, calm handling, temporal matching, lead bucketing, aggregation, duplicate imports, and partial provider data.
- Add frontend component/API tests under [frontend/src](frontend/src) and one Playwright smoke flow under [frontend/e2e](frontend/e2e).
- Run formatters, type checks, backend/frontend test suites, ingestion smoke tests against a narrow real date range, and manually verify empty/loading/error states and coverage disclosures.