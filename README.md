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


## Scanner Weinstein (développement)
- `GET /api/scanner` agrège l'OHLCV quotidien en semaines ISO clôturées.
- Critères proposés (compléments opérationnels à Weinstein) : MM30 montante, cassure au-dessus des 26 semaines précédentes, volume >= 1,5 fois sa moyenne sur dix semaines, force relative positive sur 26 semaines contre SPY.
- Minimum 40 semaines historiques et benchmark `SPY`. Cotations de plus de 10 jours : statut `STALE_DATA`.
- `PHASE2_BREAKOUT` reste un **signal de surveillance**, pas un ordre ou une promesse de performance.
- Pas de cotations fictives préchargées : scanner vide tant que l'import n'a pas été réalisé.

## Données IBKR
- `POST /api/ibkr/history` avec jeton `x-app-token` et corps `{"symbol":"AC.PA"}`.
- Requiert `IBKR_GATEWAY_URL` pointant vers une gateway **locale** et `IBKR_CONIDS_JSON` (mapping de symboles vers les vrais identifiants de contrats IBKR validés par l'utilisateur).
- Exemple `IBKR_CONIDS_JSON={"AC.PA":123456}` (identifiant fictif pour illustrer la syntaxe ; ne pas le reprendre).
- Lit **uniquement** `GET /iserver/marketdata/history`. N'envoie aucun ordre au courtier. Compte et droits de données de marché requis chez IBKR.
- La certification TLS de la gateway doit être établie correctement. Ne pas désactiver la validation TLS en production.
- Respecter les limites documentées d'IBKR : 10 requêtes/s ou 50 requêtes/min pour l'historique (septembre 2026). L'import s'effectue pour un instrument par demande.

## Stops paper
- `POST /api/stops` (avec `x-app-token`) actualise les stops selon les dernières **clôtures disponibles**.
- Break-even à +1,5R et stop suiveur à +2R. Un stop ne redescend jamais.
- Dépassement de stop : statut `SELL_REVIEW`, **pas une exécution fictive automatique** ; il manque un moteur d'exécution intraday avec gestion de l'ordre des événements, des gaps et des frais.
- Aucun processus de réconciliation périodique n'est actuellement planifié : cet endpoint doit encore être appelé manuellement ou par un ordonnanceur sécurisé.


## Orchestration paper (opt-in, non activée)
- Module `src/paper-cycle.mjs` : synchronise séquentiellement chaque symbole déclaré dans `IBKR_SYNC_SYMBOLS`, **puis seulement en cas de succès complet**, appelle `POST /api/stops`.
- En cas d'échec réseau, de donnée IBKR non vérifiée ou de mapping absent, **aucune exécution fictive de stops n'est déclenchée**. Les incidents doivent être consultés dans les journaux.
- Module `scripts/scheduler.mjs` : déclenche une tentative les jours ouvrés à 08:00 (fuseau Europe/Paris), au maximum une fois par jour par processus. L'heure correspond à une analyse des dernières données disponibles, pas à une garantie de données de la veille.
- Le service Docker est derrière le profil `automation`, **exclu du démarrage par défaut**. `PAPER_AUTOMATION_ENABLED=false` par défaut.
- Activation volontaire seulement après la validation réelle de la gateway locale IBKR, de ses droits de données et du mapping réel de tous les symboles : `docker compose --profile automation up -d`, avec `PAPER_AUTOMATION_ENABLED=true` et `IBKR_SYNC_SYMBOLS` définis dans `.env`.
- **Attention** : les données de marché réelles, les éventuels jours fériés, les divergences de cotation et l'import IBKR n'ont pas été validés sur un compte utilisateur. Ne pas activer ce service avant ces validations. Aucun ordre de courtier n'est envoyé.
- La tâche n'est pas garantie pendant les arrêts du conteneur ; un déclenchement manqué n'est pas rattrapé automatiquement.
