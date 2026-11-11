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


## Validation de la passerelle IBKR (11/11/2026)
- L'URL de base Client Portal Gateway est normalisée en `/v1/api`, selon la documentation officielle IBKR.
- Configuration attendue : `IBKR_GATEWAY_URL=https://host.docker.internal:5000` (si la gateway locale écoute sur ce port et que son certificat TLS est approuvé par le conteneur).
- Les symboles doivent être associés à des `conid` IBKR authentiques dans `IBKR_CONIDS_JSON`, **jamais** à un identifiant inventé.
- Le connecteur ne contacte que le statut d'authentification et `GET /iserver/marketdata/history`. Les routes de transmission d'ordres IBKR ne sont pas utilisées.
- Les historiques refusent les bougies futures, incohérentes, dupliquées et les volumes invalides.
- Le job GitHub `ibkr-mock-e2e` vérifie le parcours complet gateway HTTP simulée → Next.js → PostgreSQL → scanner. Cette simulation **ne prouve pas** le bon fonctionnement des droits de marché ou de la session IBKR réelle.
- L'authentification réelle et les abonnements de données sont à confirmer localement, sans communiquer de secrets dans le dépôt.


## Contrôle IBKR dans la page « Trades du matin »
- Dans l'application locale : renseigner **APP_TOKEN local** dans le champ « Jeton local », puis cliquer sur « Tester la connexion IBKR ».
- L'API interroge `POST /v1/api/iserver/auth/status` conformément à la documentation actuelle d'IBKR.
- La recherche de contrats (`GET /v1/api/iserver/secdef/search?symbol=...`) renvoie des **candidats non validés** : vérifier le titre, la place de cotation, la devise et le type d'instrument avant toute association à un conid. Aucune affectation automatique.
- Une fois les vrais conids validés, configurer `IBKR_CONIDS_JSON` **uniquement dans `.env` local**, jamais sur GitHub, puis redémarrer les conteneurs.
- Le bouton « Importer l'historique vérifié » n'est actif que si le diagnostic d'authentification réussit. L'API refuse les instruments absents de la liste autorisée.
- IBKR Client Portal Gateway doit être installé et authentifié localement et son certificat TLS doit être approuvé. Un abonnement market data peut être nécessaire.
- Le statut « NO_DATA » signifie qu'aucun historique n'a été importé ; « STALE_DATA » correspond à un cours importé mais périmé.
- Pour mettre à jour l'installation WSL sans écraser la base : `cd ~/cto-weinstein-trader && git pull --ff-only origin develop && python3 deploy_local.py`. Le script vérifie la sauvegarde avant redémarrage.


## Premier diagnostic IBKR sur le poste WSL
1. Après validation CI, mettre le projet à jour : `cd ~/cto-weinstein-trader && git pull --ff-only origin develop && python3 deploy_local.py`.
2. Lancer `python3 scripts/diagnose_ibkr.py`. Aucun identifiant bancaire n'est demandé ; le script contrôle le mode paper, le paramétrage local et l'accès au port de la gateway.
3. Télécharger la Client Portal Gateway depuis les pages officielles IBKR et l'exécuter **sur la même machine** (Java requis). Authentifier la session dans un navigateur sur `https://localhost:5000`, avec les identifiants **directement sur le site local IBKR**, jamais dans l'application ni dans GitHub.
4. Dans `.env` local seulement, configurer `IBKR_GATEWAY_URL=https://host.docker.internal:5000`. La gateway utilise normalement un certificat non reconnu : établir une relation de confiance TLS explicite dans l'environnement du conteneur avant de synchroniser des données ; ne pas désactiver globalement les vérifications TLS.
5. Sur la page Trades du matin, entrer le jeton APP_TOKEN local, tester l'état IBKR et rechercher les contrats. Vérifier manuellement les conids et les places de marché avant de les placer dans `IBKR_CONIDS_JSON` local.
6. **Ne pas activer le profil automation** avant validation des droits d'accès aux cotations, de la fraîcheur et des frais applicables.

La session brokerage peut expirer : IBKR documente un timeout après quelques minutes sans requête, ainsi que des reconnexions quotidiennes. Le planificateur à 8h n'est donc pas une garantie de synchronisation sans réauthentification. Le programme affiche l'échec et bloque les opérations paper dans ce cas.
