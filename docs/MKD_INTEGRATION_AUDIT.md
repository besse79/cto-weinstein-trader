# MarketDataHub integration — Weinstein'S audit (2026-11-16)

## Verified source inspection (develop)

- `app/api/scanner/route.ts` reads `instruments` and `candles` from the Weinstein PostgreSQL pool in `lib/db.ts`; it calculates signals through `src/weinstein.mjs`.
- `app/api/instrument/[symbol]/route.ts` reads the same local candles for stock and benchmark.
- `app/api/paper-candidates/route.ts` invokes scanner and reads `candles` for the EXSA.DE benchmark freshness check.
- `docker-compose.yml` connects Next.js to a local Docker PostgreSQL database. The original Docker volume must not be modified during integration.

## MKD facts already verified on the user's WSL

- 840 legacy symbols, 1,041,814 EOD bars; full CSV-to-MKD OHLCV parity passed.
- `/v1/legacy/resolve` and `/v1/legacy/bars` passed a live smoke test; certified PIT endpoint excludes legacy bars.
- Legacy provenance is `legacy_unverified`; `published_at` and `first_available_at` are unavailable. Never promote these bars to PIT-certified backtests.

## Required implementation and gates

1. Build a **read-only** MKD market-data adapter behind a feature flag, with local-candle fallback, no automatic trading or writes to the legacy database.
2. Match existing consumer contract exactly: `day`, `open`, `high`, `low`, `close`, `volume`; ascending dates, same-currency benchmark, bounded historical windows.
3. Confirm whether MKD data includes benchmark `EXSA.DE` and `SPY` and test their resolution. Explicitly reject missing/ambiguous mappings.
4. Compare local and MKD OHLCV per symbol/date, accounting for differing local history or revisions; report all differences.
5. Compare scanner outputs per instrument and portfolio candidates, with a fixed `asOf` and identical inputs. Any mismatch blocks cutover.
6. Keep PIT backtests on certified data only; the legacy adapter must not bypass this restriction.
7. Test API failure, timeout, stale data, missing benchmark, and fallback behavior.
8. Only after tests and rollback verification, activate MKD read path. Preserve original Weinstein Docker volume and credentials.

## Current status

Audit performed; adapter, tests, and cutover **not yet implemented or validated**.
