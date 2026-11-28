# MKD / Weinstein'S: benchmark qualification (18 November 2026)

## Current evidence
The 18-November acceptance report compares 802 instruments with matching OHLCV and signals, and 36 additional instruments with OHLCV only (CHF 12, SEK 11, GBP 5, PLN 4, DKK 3, NOK 1). The 267 NO_HISTORY records have **zero candles in the W local database**; this does not prove that MKD lacks candles.

## Benchmark acceptance criteria
For each of GBP, CHF, SEK, PLN, DKK, NOK:
1. Identify a liquid, freely obtainable, same-currency broad-market index or ETF; document symbol, issuer, exchange, currency, provider, and adjusted/unadjusted price semantics.
2. Verify MKD instrument resolution and at least five years of daily OHLCV; verify currency and timestamps; never assume a Yahoo ticker is valid without an actual data check.
3. Compare W and MKD reference candles and weekly aggregation; check holiday-calendar alignment, staleness, splits and volume.
4. Re-run the complete signal parity, including eligibility, support, watch, stops and PAPER.
5. Maintain PAPER buying restriction to EUR until FX conversion, dealing costs and portfolio risk limits are independently implemented and tested.

**No benchmark ticker is approved in this document.** Unsupported currencies remain fail-closed.

## Coverage triage
The script `scripts/mkd-coverage-triage.mjs` exports all 267 NO_HISTORY symbols from the latest acceptance report. Reconcile each symbol against MKD mapping and bar count, then classify:
- MKD bars exist, W bars absent: investigate scope and date range; no automatic backfill.
- MKD mapping exists but no bars: collection backlog.
- MKD mapping absent: universe / identifier mapping backlog.
- Delisted or invalid instrument: evidence-backed exclusion, not silent deletion.

## Source switch
The `src/mkd-source-policy.mjs` module implements fail-closed policy, but is **not wired to production scanner**. The local scanner remains the only active source. A safe eventual activation requires full coverage, a signed or independently verified gate, an explicit deployment change, a backup and tested rollback, and observation. Legacy MKD bars are not PIT and remain prohibited for historical as-of backtests.
