# CTO Weinstein Trader

Application de suivi et simulation de trading fondée sur la méthode de Stan Weinstein.

## Périmètre
- Capital fictif initial : **500 EUR**
- Portefeuille **CTO** (pas PEA)
- Interface Next.js / Node.js ; stockage PostgreSQL
- IBKR : **données de marché en lecture seule** (connecteur à compléter)
- Ordres **paper locaux uniquement**, aucun passage d'ordre réel
- Analyse hebdomadaire : MM30, volumes, phases Weinstein et force relative
- Gestion du risque : stop initial, break-even à +1,5R, trailing à partir de +2R
- Bloquer toute simulation si données insuffisantes ou périmées

## Gestion du développement
- `main` : branche de référence
- `develop` : développement et intégration
- `feature/*` : fonctionnalités ; contributions via pull requests
- Aucun secret dans Git. Fichiers `.env`, identifiants IBKR et sauvegardes exclus.

## État
Base du projet Git initialisée le 11 novembre 2026. La V0.3 existante est en cours de migration dans le dépôt. Ne pas considérer les mécanismes de stops ou les cotations IBKR comme opérationnels avant tests documentés.

## Sécurité
Ce projet est expérimental et ne passe **aucun ordre réel**. Les résultats paper ne garantissent aucune performance future.
