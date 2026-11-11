# CTO Weinstein Trader

Application web de simulation de trading (CTO) selon Stan Weinstein.

## Statut
- Branche `develop` : intégration expérimentale Next.js / PostgreSQL / API.
- Capital initial local : **500 EUR**.
- Ordres exclusivement **PAPER** : aucune opération d'exécution chez IBKR.
- IBKR : contrôle d'authentification local en **lecture seule** ; récupération des cours non implémentée.
- Écran 1 : liste de surveillance, achats bloqués (scanner Weinstein non validé).
- Écran 2 : positions, alertes de stop et ventes fictives manuelles.
- Stop initial enregistré ; break-even / trailing calculables dans le module de risque mais **non encore automatisés dans la base**.
- Pas de gestion de change pour les titres USD ; seuls instruments EUR autorisés dans l'API pour l'instant.

## Lancer localement
Prérequis : Docker et Docker Compose.

1. Copier `.env.example` vers `.env` et y générer des secrets uniques pour `POSTGRES_PASSWORD` et `APP_TOKEN`.
2. Exécuter `docker compose up -d`.
3. Ouvrir `http://localhost:3010`.

La base est initialisée lors de la première création du volume PostgreSQL. Ne jamais supprimer le volume `pgdata` sans sauvegarde vérifiée ; la restauration n'est pas encore automatisée dans ce dépôt.

## Tests
- `npm test` : règles de risque, break-even, stop.
- `npm run typecheck` : TypeScript.
- `npm run build` : Next.js.
- Le workflow GitHub Actions exécute ces commandes sur chaque push dans `develop`.

## Limites et garde-fous
- L'import OHLCV est réservé à un jeton APP_TOKEN local et les données ne constituent pas encore une source IBKR certifiée.
- Les achats restent manuels via API pour les tests ; il n'y a pas de signal Weinstein officiellement validé.
- Pas d'exécution automatique de stop ni de simulation intraday des gaps.
- Les cours manquants/périmés bloquent les transactions fictives.
- Pas d'ordres réels, pas de clés de courtier dans le dépôt.
- Dépôt public : ne jamais y placer de jetons, identifiants ou données privées.
