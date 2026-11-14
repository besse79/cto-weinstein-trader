# CTO Weinstein Trader — Yahoo Finance / Paper Trading

Application Next.js et PostgreSQL d'analyse technique selon Stan Weinstein. Portefeuille fictif de **500 €**, aucune connexion bancaire ou ordre réel.

## Installer et mettre à jour sous WSL

Prérequis : WSL Ubuntu, Git et Docker Desktop avec intégration WSL.

Sur une installation existante :

```bash
cd ~/cto-weinstein-trader && git pull --ff-only origin develop && python3 deploy_local.py
```

URL locale : http://localhost:3010

L'installateur vérifie Docker et la sauvegarde préalable (sources et PostgreSQL), applique les migrations nécessaires, démarre PostgreSQL et Next.js et vérifie le mode paper. Restaurer une sauvegarde via `python3 restore.py <chemin-de-sauvegarde>` (vérification) ; `--apply` est une action destructive avec confirmation explicite.

## Historique de marché — source Yahoo Finance

Le panneau « Trades du matin » propose un **import manuel** de cinq années de données quotidiennes OHLCV pour l'ensemble des six instruments connus, benchmarks inclus :

- Actions EUR : `AC.PA` (Accor), `SU.PA`, `LR.PA`, `SAF.PA`.
- Benchmark EUR : `EXSA.DE` (ETF STOXX Europe 600 en EUR).
- Benchmark USD : `SPY` (ETF S&P 500 en USD ; uniquement benchmark).

Pour importer : sélectionner un lot dans « Trades du matin » puis cliquer directement sur **« Importer ce lot Yahoo »**. Aucune saisie de jeton dans le navigateur. L'application conserve l'historique dans PostgreSQL, calcule la moyenne mobile hebdomadaire 30 semaines, le volume et la force relative pour les **semaines clôturées**. Aucune transaction n'est générée par un import.

### Fiabilité et restrictions

- L'endpoint Yahoo Chart est **non officiel**, gratuit dans les conditions où il est accessible, sans garantie ni contrat de service. Yahoo peut renvoyer 401/429, interrompre ou modifier son format.
- Les conditions générales Yahoo restreignent l'accès automatisé aux données sans autorisation préalable. Il revient à l'utilisateur de vérifier ses droits d'utilisation ; aucun contournement de contrôles, rotation de proxy ou scraping intensif n'est fourni. **L'import est manuel et non planifié.**
- Une synchronisation de groupe est **atomique** : si un instrument, une devise, une cotation ou une connexion ne passe pas les contrôles, rien n'est écrit. Les métadonnées d'import sont enregistrées dans `market_sync_audit`.
- Vérification du symbole, de la devise, des dates et des volumes, de la cohérence haut/bas/ouverture/clôture ; exclusion des séances en cours et rejet des historiques périmés de plus de dix jours. Ce contrôle ne garantit pas la justesse économique des cotations.
- Les données Yahoo ne constituent pas un flux d'exécution de courtier. Les dividendes, ajustements de splits et frais doivent être validés avant un backtest de performance sérieux.
- En cas d'indisponibilité de Yahoo ou de conditions incompatibles, prévoir un import de fichier ou un fournisseur sous licence. L'architecture PostgreSQL et le scanner restent indépendants du fournisseur.

## Scanner et risque

- Scanner : MM30 hebdomadaire montante ; cassure des 26 semaines précédentes ; volume au moins 1,5× sa moyenne ; force relative positive sur 26 semaines contre le benchmark de même devise.
- Les signaux restent des **observations**, pas des ordres. Aucune transaction d'achat automatisée.
- Simulation des stops sur les barres quotidiennes clôturées, y compris gaps et glissement fictif, sans garantie de réalisme des exécutions.
- Pas de conversion FX pour les titres en USD : pas d'achat paper USD avant implémentation du change. Le capital demeure en EUR et fixé à 500 €.

## Tests

```bash
npm install
npm audit --audit-level=high
npm test
npm run typecheck
npm run build
```

GitHub Actions vérifie également la base PostgreSQL, les transactions paper, les stops, l'installation/restauration Docker et un serveur **Yahoo simulé**, sans solliciter Yahoo pendant les tests.

## Sécurité

La clé `APP_TOKEN` reste uniquement dans le fichier local `.env`, jamais dans GitHub. Le site est publié sur `127.0.0.1:3010` uniquement. Il n'existe aucune route vers un courtier ni aucun composant d'exécution d'ordres réels. L'application n'envoie pas d'identifiants à Yahoo.

Les anciens endpoints IBKR et leur ordonnanceur ont été retirés du projet.

## Anticipation de la phase 2 : base de phase 1

Le scanner distingue les états calculés **uniquement sur les semaines ISO terminées** :

- **`PHASE1_LATE` / `PHASE1_END`** : base des 16 dernières semaines dont l'amplitude est au plus 30 %, baisse préalable d'au moins 18 % par rapport à un sommet historique de référence, pente MM30 sur six semaines comprise entre -4 % et +4 %, cours au moins égal à 95 % de la MM30, force relative à 26 semaines supérieure ou égale à -5 %, et distance à la résistance de 0 à 10 %. **Veille uniquement, pas d'achat.**
- **`PHASE1_BASE` / `PHASE1_FORMING`** : mêmes prérequis, distance à la résistance entre 10 et 20 %. Stade préliminaire de veille, pas d'achat.
- **`PHASE2_BREAKOUT` / `PHASE2_ENTRY`** : clôture hebdomadaire dépassant les sommets des 26 semaines précédentes, cours supérieur à MM30, MM30 montante, volume hebdomadaire au moins 1,5× celui des dix semaines précédentes, force relative positive contre le benchmark de même devise, et base préalable de 12 semaines dont l'amplitude est de 30 % maximum. Signal indicatif, **aucun ordre automatique**.
- **`WATCH`** : autres profils non classés ; ne pas confondre une consolidation en phase 3 avec une base de phase 1.

Ces paramètres sont des **heuristiques opérationnelles à backtester**, pas une garantie de conformité à une phase Weinstein. Un `setupScore` de 0 à 100 sert uniquement au classement : il ne représente ni une probabilité de hausse ni une estimation de rendement. Une référence absente ou périmée empêche tout signal exploitable.

Le nombre d'instruments surveillés reste pour l'instant limité aux quatre actions et deux benchmarks importés ; l'élargissement de l'univers devra être traité séparément avec gestion des droits d'accès aux données et de la charge de synchronisation Yahoo.

## Univers élargi de surveillance (novembre 2026)

La migration SQL `003_french_large_caps.sql` ajoute 20 sociétés cotées à Paris à la base des quatre actions initiales, pour **24 actions en EUR et deux benchmarks** (EXSA.DE en EUR, SPY en USD). Les mnémoniques proviennent d'une sélection de sociétés du SBF 120 publiées par Euronext ; **ce n'est pas la composition exhaustive du CAC 40 ni du SBF 120**. La composition des indices peut évoluer.

- `GET /api/universe` affiche les instruments déjà enregistrés, le nombre de bougies et la date du dernier cours, groupés en lots de six maximum.
- Dans l'interface, l'utilisateur sélectionne **un lot**, puis déclenche explicitement son import Yahoo. L'ancien appel `{ "all": true }` reste compatible mais importe **uniquement les six instruments initiaux**. Les nouveaux appels utilisent `{ "symbols": ["AI.PA", "AIR.PA"] }` avec de un à six symboles distincts présents en base.
- Chaque lot est atomique : symbole, devise ou prix invalide => aucune bougie de ce lot n'est écrite. Aucun contournement des restrictions Yahoo, aucun ordonnanceur et aucun transfert d'ordre.
- Le scanner comporte trois listes : **cassures de phase 2**, **bases de fin de phase 1**, **rejets / données absentes**. Chaque rejet décrit les critères manquants.
- Une cassure confirmée mais située à plus de **20 % au-dessus de la MM30** est classée `PHASE2_EXTENDED`, et n'est **pas éligible** au signal d'entrée initial. Ce seuil conservateur est heuristique et doit être backtesté.
- Les titres qui ne sont pas encore importés restent `NO_DATA` et ne peuvent pas générer d'achats.

**Périmètre des tests :** API Yahoo simulée, import réel initial de six titres confirmé par l'utilisateur, mais la disponibilité des nouveaux symboles n'a pas encore été testée sur son WSL. Une place de cotation ou une devise incompatible bloque l'import concerné sans donner de faux signal.

La sauvegarde vérifiée des sources et de PostgreSQL est exécutée par `deploy_local.py` **avant** la migration 003. Les données historiques déjà présentes restent en place.

## Surveillance anticipée V2 : cassure quotidienne non confirmée

Le scanner conserve deux lectures entièrement séparées :

1. **Phase Weinstein confirmée** : les critères restent calculés uniquement sur les semaines ISO **terminées**. Un cours quotidien postérieur à la dernière semaine close ne peut jamais rendre un achat fictif éligible.
2. **Score de veille quotidien** : note explicative 0 à 100, indépendante de la phase et **sans valeur de probabilité de gain**. Elle additionne des composantes plafonnées : proximité de résistance 26 semaines (30), cours supérieur à la MM30 (20), MM30 haussière (15), force relative (15), volume de la **dernière semaine terminée** (10), base préalable (10).

Le statut `PROVISIONAL_BREAKOUT` apparaît uniquement si un **cours quotidien clôturé dans la semaine encore en cours** dépasse le plus haut des 26 **semaines antérieures entièrement terminées**. Cette détection ne valide aucune phase 2 et n'autorise aucun achat. `NEAR_RESISTANCE` signale un cours situé à 10 % ou moins sous la résistance.

La page du scanner s'ouvre sur les **cinq meilleures configurations disposant de données fraîches** (tri par score de veille). Des onglets séparent les entrées phase 2, bases de phase 1, autres profils et **données absentes/périmées**. Aucune valeur sans historique suffisant ou benchmark valable n'obtient de score de veille.

La fiche détaillée peut afficher une marque distincte du dernier cours quotidien et de la résistance de veille, **sans incorporer cette séance à la courbe des semaines closes**. La cotation n'est pas garantie comme temps réel : elle dépend du dernier import Yahoo manuel. Aucune collecte automatique, aucun ordre réel, capital paper 500 EUR conservé.

## V3 — Reconstitution historique des phases Weinstein

La fiche individuelle restitue une **estimation heuristique**, semaine par semaine, des phases :
- **Phase 1** : base contenue, MM30 stabilisée après un repli, force relative suffisamment soutenue.
- **Phase 2** : cassure sur une clôture hebdomadaire avec volume, force relative et base suffisants ; prolongation de la tendance tant que les contrôles restent cohérents.
- **Phase 3** : consolidation et ralentissement de MM30 après une phase 2 identifiée.
- **Phase 4** : cours sous la MM30 avec pente négative.
- **Non classée** : données insuffisantes, benchmark manquant ou configuration ambiguë.

Chaque étape utilise uniquement les bougies et références **disponibles jusqu'à sa clôture hebdomadaire** (pas d'anticipation de données). La frise colore les intervalles sur le graphique des prix et montre les points de cassure confirmée. Les transitions précédentes sont consultables sous le graphique.

Un tableau descriptif affiche, pour chaque cassure historiquement détectée, les rendements bruts de l'action après **4, 8 et 12 semaines**, uniquement si l'horizon est entièrement observé. Il ne s'agit **pas d'un backtest de portefeuille** : absence de frais et slippage, ajustements splits/dividendes non vérifiés, biais de survivance de l'univers actuel, absence de conversion FX, et aucun modèle de passage d'ordres. Le taux positif et le rendement moyen ne prédisent aucun résultat futur.

La nouvelle fonctionnalité est **en lecture seule**, calculée depuis les historiques PostgreSQL existants. Aucun nouvel accès Yahoo, aucune migration de données, aucune commande de courtier, et le portefeuille demeure fictif à **500 €**.

Commande WSL après CI verte : `cd ~/cto-weinstein-trader && git pull --ff-only origin develop && python3 deploy_local.py`.

## V4 — lot 1 : risque et simulation de performance Weinstein

La branche `feature/weinstein-v4-integrated` poursuit le développement commencé dans l'autre discussion, sans modifier `develop` avant validation.

- Position fictive : capital de départ **500 €**, risque théorique **1 %** par entrée, exposition maximum **25 %** par action et taille entière d'actions ; calcul existant `src/paper-risk.mjs`, conservé.
- Événement historique : uniquement cassure de phase 2 sur une clôture hebdomadaire **déjà terminée**, avec données de benchmark disponibles à cette date.
- Exécution fictive : **au plus tôt à l'ouverture de la semaine suivante** ; stop pris sur les huit semaines terminées à la date du signal ; simulation de stop et de gap d'ouverture, commission fixe fictive de 0,50 € par côté, glissement simulé de 0,1 %.
- Horizon : **4, 8, 12 ou 26 semaines**. Si aucune sortie historique ne peut être observée, la transaction n'est pas intégrée aux résultats. Les opérations par action sont séquentielles, sans chevauchement.
- API lecture seule `GET /api/instrument/AC.PA/backtest?weeks=12`, intégrée à la fiche action. Aucun ordre fictif persistant n'est émis. Les titres USD sont **bloqués** tant que la conversion historique EUR/USD n'est pas implémentée.
- Indicateurs : capital fictif final, performance, transactions terminées, taux de transactions positives, recul maximum calculé sur **l'équité réalisée uniquement** (qui sous-estime potentiellement le drawdown intraposition), journal de transactions et signaux sautés.

**Limites importantes :** ce lot simule **une seule action à la fois**, et non encore le portefeuille multi-actifs de 24 valeurs. Commissions et slippage sont simplifiés. Historique Yahoo non corrigé/validé des dividendes et splits, univers courant soumis au biais de survivance, aucun change historique. Il ne faut pas traiter ses performances comme une validation de rentabilité ni comme des recommandations d'achat.

### Limites entre V4 et V5

**Reste en V4 :** consolidation des signaux et du score multi-titres, véritable backtest chronologique d'un portefeuille à plusieurs positions avec capital partagé, gestion des stops et frais, tests de robustesse de données et rapport de performance multi-actifs avant promotion de la version.

**V5 seulement :** comparaison structurée et hors échantillon de Weinstein contre **Minervini/SEPA**, **CAN SLIM**, analyse sectorielle et **Price Action** ; Trend Following incorporé comme famille, RSI/MACD indicateurs auxiliaires, SMC/ICT écarté et approche Value distincte. Comparaison après frais et prise en compte des biais de sélection.

Cette version reste strictement **PAPER ONLY**, sans IBKR ni ordre réel.

## V4 finale — portefeuille multi-actions fictif partagé

La V4 ajoute **un seul capital fictif de 500 € partagé par toutes les actions françaises EUR actuellement importées**, sans dupliquer les 500 € pour chaque titre. Accessible dans l'onglet **« 03 · Backtest V4 »**, cette simulation est indépendante des ordres fictifs enregistrés dans le portefeuille opérationnel et ne modifie jamais les tables de trading.

- **Signaux chronologiques** : cassure Weinstein validée à la clôture d'une semaine, classement déterministe par force relative et volume connus à cette date, puis entrée uniquement à l'ouverture de la semaine calendaire suivante si une bougie existe.
- **Gestion du capital** : maximum quatre positions longues simultanées, disponibilité de trésorerie non négative, limite de 25 % de liquidités disponibles et risque théorique de 1 % des liquidités disponibles au moment de l'entrée. Ces limites peuvent réduire l'exposition effective, notamment avec seulement 500 € et des actions non fractionnables.
- **Exécution fictive** : frais forfaitaires de 0,50 € à chaque achat/vente, glissement 0,1 %, stop défini avec les huit semaines précédentes, sauts sous le stop exécutés au prix d'ouverture, sortie sinon au stop ou après 4/8/12/26 semaines. Les calculs utilisent des bougies hebdomadaires, pas un carnet d'ordres réel.
- **Performance consolidée** : courbe d'équité marquée aux cours de clôture chaque semaine, drawdown maximum sur cette équité (positions ouvertes incluses), opérations, signalements refusés et nombre de positions ouvertes.
- **Contrôle chronologique** : vue descriptive en trois périodes fixes, 60 % / 20 % / 20 % de l'historique. Ces périodes ne constituent **pas** un test hors échantillon optimisé.
- **Données manquantes** : simulation bloquée si une position ouverte traverse une semaine dépourvue de bougie ; jamais de prix de vente inventé.
- **Périmètre** : uniquement titres EUR pour éviter un change USD/EUR non implémenté. Les titres absents ou périmés sont exclus ; un benchmark EUR disponible et frais est obligatoire.

**Important** : la V4 est une simulation chronologique techniquement testée, **pas une preuve statistique de rentabilité**. Les prix Yahoo (source non officielle) et leurs ajustements splits/dividendes n'ont pas été vérifiés indépendamment. L'univers de titres actuel implique un biais de survivance, et l'ordre d'exécution intrase semaine reste approximatif en OHLC. Le backtest de portefeuille n'envoie aucun ordre, fictif persistant ou réel.

**V5 :** seulement après cette base, comparaison de Minervini/SEPA, CAN SLIM, force sectorielle et Price Action à Weinstein avec protocoles comparables et critères de validation hors échantillon.

## Interface locale sans saisie de jeton

L'application est liée par Docker à **127.0.0.1:3010** uniquement. Une action explicite du navigateur (import Yahoo ou vente fictive) est transmise à `POST /api/local-actions`. Ce point d'entrée vérifie que l'hôte est exactement `localhost:3010` ou `127.0.0.1:3010`, que l'en-tête `Origin` correspond exactement à cet hôte, et rejette les appels intersites. Le secret `APP_TOKEN` est lu côté serveur dans `.env` et utilisé uniquement pour déléguer aux endpoints déjà protégés ; il n'est jamais injecté dans du JavaScript navigateur ni retourné dans la réponse HTTP.

Les endpoints `POST /api/orders` et `POST /api/market/sync` **conservent leur contrôle d'authentification**. Le nouveau point d'entrée n'autorise que `sync` (import manuel d'une liste existante de maximum six symboles) et `sell` (vente PAPER). L'enregistrement d'un nouvel achat ne passe pas par ce point d'entrée.

**Portée de sécurité** : cette configuration est prévue pour **un poste utilisateur de confiance**, non pour un serveur partagé. Toute application ou utilisateur ayant un accès local direct au port peut tenter d'agir ; le mécanisme empêche surtout les appels de pages externes et le transport du secret vers le navigateur. Ne pas publier le port Docker sur `0.0.0.0`, ni exposer l'application par reverse proxy sans authentification supplémentaire. L'import reste manuel, sans programmation.

## Préparation des achats PAPER — lundi 16 novembre 2026

La page « 01 · Trades du matin » affiche une sélection **quotidienne** des actions EUR disposant d'un **signal phase 2 confirmé pendant la dernière semaine ISO clôturée**. Une action phase 1, un mouvement provisoire ou une ancienne cassure ne constitue pas un candidat à l'achat.

Le tableau indique le dernier cours journalier clôturé enregistré, sa date, le support servant de stop initial, la quantité entière autorisée (risque théorique maximum 1 % des liquidités disponibles, allocation maximum 25 % des liquidités disponibles, frais simulés de 0,50 € à l'achat et à la vente), et les raisons de chaque exclusion. Maximum quatre positions distinctes ; pas de nouvel achat d'une action déjà détenue.

Un utilisateur peut sélectionner un lot ou déclencher **l'import manuel de tous les lots** ; chaque requête reste explicitement initiée depuis le navigateur, sans ordonnanceur ni contournement des conditions Yahoo. Le référentiel actuel contient 24 actions EUR et deux benchmarks : **l'élargissement US et la collecte automatique ne sont pas livrés dans cette étape**.

**L'ordre n'est jamais automatique** : le bouton « Acheter fictivement » demande une confirmation explicite. Le serveur revalide l'éligibilité du candidat, le cours et la quantité ; le moteur d'ordres PAPER recontrôle le risque, les liquidités et les doublons au sein d'une transaction. Une position simulée est ensuite visible dans l'onglet « 02 · Portefeuille ». Le prix utilisé est **la dernière clôture quotidienne importée**, pas le prix réel d'ouverture du lundi ni un flux temps réel. Un stop ne garantit pas une perte limitée à 1 % en présence d'un gap.

En l'absence d'un candidat valable, aucun ordre n'est créé. L'API `GET /api/paper-candidates` est en lecture seule. `POST /api/paper-entry` est authentifié côté serveur et `POST /api/local-actions` n'expose qu'une action `buy` locale avec revalidation complète et protection Origin. Aucune route d'achat réel ni connexion courtier n'existe.

**Lundi :** lancer l'application, importer les lots Yahoo nécessaires, actualiser l'analyse et valider éventuellement une transaction fictive. La collecte reste manuelle et la recette WSL sur les cours réels n'est pas attestée par la CI, qui utilise des données Yahoo simulées.

## Collecte quotidienne automatisée — stockage PostgreSQL

Le conteneur Docker `scheduler` est installé automatiquement par `deploy_local.py` **sur WSL local**, après la sauvegarde vérifiée de la base, la migration idempotente `004_market_collection.sql` et le démarrage de l'application. Aucun cron système ni `APP_TOKEN` à saisir. Le collecteur n'est **pas** lancé dans GitHub Actions ni dans les commandes Docker sans le profil `automation`.

Fonctionnement :
- **Démarrage** : lecture du référentiel PostgreSQL, récupération progressive des historiques manquants/insuffisants (moins de 250 séances) sur une fenêtre de cinq ans, et rattrapage des titres dont la dernière séance est ancienne. Sans réimporter ceux déjà complets et récents.
- **Lundi à vendredi 20 h 45, heure de Paris** : mise à jour des actions EUR et benchmark `EXSA.DE`.
- **Lundi à vendredi 23 h 15, heure de Paris** : mise à jour du benchmark US `SPY` et des futurs titres USD enregistrés.
- **Incrémental** : fenêtre glissante de trois mois pour les titres ayant déjà un historique de 250 séances ou plus, insertion/mise à jour sans doublons dans `candles`. Un premier import utilise cinq ans ; les prix déjà acquis restent conservés.
- **Protection des appels** : lots de six au maximum, un seul collecteur à la fois (verrou PostgreSQL), maximum 120 symboles par exécution et rotation des valeurs secondaires si un univers futur dépasse cette limite ; jamais de requêtes à fréquence intraday. Jusqu'à trois essais espacés d'une heure pour un traitement en échec.
- **Traçabilité** : `market_job_runs` conserve les dates, états, nombres de réussites/échecs et erreurs ; l'interface « Trades du matin » montre la couverture et les cinq derniers traitements.
- **Robustesse** : chaque lot est atomique, un lot échoué n'efface jamais les historiques précédents. Les erreurs et rejets de qualité sont visibles. Les autres lots peuvent être traités, sauf limitation explicite par le fournisseur.

**Attention :** la collecte utilise ici l'adaptateur Yahoo Finance gratuit déjà présent, **non officiel**, sans SLA ni garantie de droit de collecte automatisée. Le fonctionnement doit rester conforme aux conditions applicables au compte et aux données ; désactiver le conteneur si le fournisseur interdit cet usage ou renvoie un refus. Une API FMP gratuite peut être intégrée ultérieurement après vérification des instruments et de la licence, sans changement du stockage. La collecte quotidienne n'est pas une autorisation de trading et n'exécute **aucun** achat ou vente.

**Disponibilité** : Docker Desktop et WSL doivent être démarrés aux heures prévues. Le conteneur redémarre automatiquement avec Docker ; si le poste était éteint, il tente de rattraper les historiques absents ou périmés lors de son retour, mais ne promet pas des données non disponibles chez la source.

**Commandes de diagnostic (optionnelles)** :
```bash
docker compose -p cto_weinstein --profile automation ps
docker compose -p cto_weinstein --profile automation logs --tail=80 scheduler
```
Arrêt volontaire : `docker compose -p cto_weinstein --profile automation stop scheduler`. Un redéploiement normal réactive la collecte. L'API de statut en lecture seule est `GET /api/market/collection-status`.
