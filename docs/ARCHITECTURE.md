# Architecture cible

- Frontend : Next.js + React.
- API : Node.js, validation serveur et contrôle des accès.
- Base : PostgreSQL avec migrations versionnées.
- Données boursières : adaptateur IBKR strictement lecture seule, dates/fuseaux/qualité de cotation contrôlés.
- Ordres : moteur de simulation paper **interne** et indépendant d'IBKR.
- Gestion des risques : règles métier dans `src/risk.mjs`, testables sans courtier.
- Aucun levier et aucun ordre réel.
- CTO : ne pas conserver les contrôles historiques PEA de la V0.3.
- Capital initial : 500 EUR ; comptes multidevises, frais et change à implémenter avant simulation validée.
- Scanner quotidien Weinstein et exécution stop sur données intraday **non implémentés à ce stade**.

## Sécurité
Ne jamais enregistrer les identifiants IBKR, variables `.env` ou données personnelles sur Git. Les opérations sur PostgreSQL doivent être transactionnelles. Bloquer les ordres sur données de marché obsolètes ou incohérentes.

## Roadmap
1. Intégration et audit du socle V0.3.
2. Schéma CTO, ledger paper, opérations fractionnées, frais/FX.
3. Lecture seule des données IBKR et gestion de la fraîcheur.
4. Scanner Weinstein (MM30, Mansfield, volume, supports/résistances).
5. Moteur de stops et tests de gaps/glissements, audit et tableau de bord.
