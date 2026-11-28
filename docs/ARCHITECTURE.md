# W (Weinstein'S) — architecture actuelle et évolution MKD

**W** : `besse79/cto-weinstein-trader` ; **MKD** : `besse79/market-data-hub` ; **QE** : QuantEdge ; **B** : BuffettValue.

## Socle existant W
- Next.js / Node et PostgreSQL W isolé. Les données historiques W, les ordres PAPER, les stops et les paramètres restent sur leur base actuelle.
- Sources actuellement collectées : Yahoo Chart non officiel; données validées en lecture et stockées sur W. Aucune donnée en provenance d'IBKR ni connexion de trading réelle.
- Méthode Weinstein hebdomadaire (MM30, résistance 26 semaines, volumes, force relative même devise), phases heuristiques 1–4, stop sur séances clôturées.
- Scanner global inchangé en comportement par défaut ; sélection PAPER explicitement limitée aux actions EUR et au risque <= 1 % et taille de position <= 25 % du portefeuille initial 500 EUR.
- MKD ne contient ni portefeuille, ni ordres, ni stops.

## V4.1 : optimisation sans changement SQL
- `/api/scanner` : accès global par défaut; `?currency=EUR` ou `USD` pour l'analyse ciblée. La sélection PAPER demande EUR pour éviter les appels SQL/Javascript non requis. La formule de signal ne change pas.
- `/api/dashboard` : dernier cours via jointure latérale et clé primaire existante `candles(instrument_id,day)` ; aucun index/migration.
- CI vérifie un catalogue synthétique de >1 100 instruments; l'objectif de délai mesuré sur WSL réel relève de l'Issue W #26.

## V4.2-A : lecture seule / recherche uniquement
- Adaptateur pur `src/mkd-readonly.mjs`, fonctions FX pures `src/fx-valuation.mjs`, comparaison de parité `src/mkd-parity.mjs`.
- API de démonstration `GET /api/market/mkd-preview?symbol=AC.PA&mic=XPAR&start=2026-11-09&end=2026-11-13&as_of=2026-11-15T12:00:00Z`.
- Le **feature flag** `MKD_READ_ONLY_ENABLED=false` par défaut empêche toute tentative réseau vers MKD. Les données locales sont clairement marquées `source=W_LOCAL`, jamais comme des données MKD certifiées.
- Flag activé et MKD accessible : résolution `/v1/instruments`, puis `/v1/bars` ; vérification symbole, MIC, devise, OHLCV, date de publication et de première disponibilité <= `as_of`, présence d'une source/version et unicité de date.
- MKD inaccessible / HTTP 404 (données pas encore importées), HTTP 429 / 5xx : fallback **identifié** `source=W_LOCAL_FALLBACK`, `verified=false`, motif explicite.
- MKD retourne des données incohérentes : blocage ; **aucun fallback qui masquerait une anomalie**.
- Pour une action USD certifiée MKD, possibilité de consulter le taux EUR/USD point-in-time et un calcul de taille/risque **purement hypothétique**, utilisant un capital d'exemple de 500 € (pas les soldes opérationnels).
- Taux absent ou périmé : pas d'équivalence inventée ; les achats fictifs USD sont toujours interdits.
- **Le scanner opérationnel continue de lire W localement**, sans mélange des séries ; bascule MKD bloquée tant que les tests sur données réelles ne prouvent pas la parité.

## Parité W <-> MKD
- `compareMarketSeries` vérifie dates, OHLCV, devise et volume avec une tolérance explicite de 0,00001 unité prix; `compareWeinsteinSignals` refuse les différences de phase, signal, éligibilité et benchmark.
- Avant toute bascule, comparer S&P 500 et l'univers Euronext réellement identifié (la liste STOXX600 ETF proxy n'est **pas** l'intégralité d'Euronext), SPY, EXSA.DE, 4 titres Yahoo bloqués et signaux historiques.
- La DB W reste intacte; snapshots, sauvegarde/restauration et preuves WSL sont exigés. Les tests unitaires de contrat ne remplacent **pas** la recette de parité réelle.

## Gate de sécurité
Aucun changement de schéma PostgreSQL W, aucun ordonnancement déclenché, aucun ordre réel, aucun ordre USD PAPER. La V4.2-B exige une approbation séparée de son ledger de conversions et des soldes USD dans la **base métier W**, jamais dans MKD.

Références : [MKD ADR-001](https://github.com/besse79/market-data-hub/blob/feature/v1-foundation/docs/ADR-001-MKD-W-QE-B-DATA-BOUNDARIES.md), [MKD PR #12](https://github.com/besse79/market-data-hub/pull/12), [W Issues #26](https://github.com/besse79/cto-weinstein-trader/issues/26) et [#27](https://github.com/besse79/cto-weinstein-trader/issues/27).
