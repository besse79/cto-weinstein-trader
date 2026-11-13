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

Pour importer : saisir le **APP_TOKEN local** présent dans `.env` (ne jamais le publier), puis cliquer « Importer les historiques Yahoo (5 ans) ». L'application conserve l'historique dans PostgreSQL, calcule la moyenne mobile hebdomadaire 30 semaines, le volume et la force relative pour les **semaines clôturées**. Aucune transaction n'est générée par un import.

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
