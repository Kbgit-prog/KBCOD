# Rapport d'avancement — 26/11/2026

## Livré
| Phase | Développé | Tests |
|---|---|---|
| 0 Audit | Recherche EasySell, matrice de parité, étude d'hébergement, architecture, modèle de données, risques | — |
| 1 Fondations | Serveur Hono, PostgreSQL (21 tables, schéma isolé), auth jeton de session + échange de jeton, multi-apps, webhooks HMAC + RGPD, chiffrement AES-256-GCM, file de travaux durable | Jetons, HMAC, RGPD, isolation (Vitest) |
| 2 Formulaire | Constructeur (23 types de champs, 14 blocs, glisser-déposer, conditions, design complet, CSS validé, messages, versions, produits), rendu Shadow DOM, Popup/Embedded/sticky, extension de thème | Chromium : admin (desktop/mobile, 0 erreur JS), parcours vitrine complet |
| 3 Commandes | `orderCreate` PENDING, prix serveur, offres, livraison, codes, idempotence, verrou, réconciliation | 8 tests (doublons, prix manipulés, réseau perdu, isolation) |
| 4 Antifraude | Fenêtres glissantes multi-identifiants, listes, robots, Turnstile, OTP | 8 tests (bornes 72 h, IP partagée, listes, bout en bout) |
| 5 Sheets | OAuth, fichier/onglet, mapping, ligne/commande ou produit, file + retries + anti-doublon, statuts | Panne 503, jeton révoqué, colonne absente, doublon |
| 6 Meta | Pixel + CAPI, event_id partagé, étapes COD, journal, test | Dédup navigateur/serveur, retry même id, code 190 |
| 7 Compléments | Offres (quantité, 1-Tick, downsell, 1-Click post-commande), abandons, SMS/WhatsApp (Twilio, webhook, WhatsApp Cloud), statistiques, export/import | Partiels |
| 8 Livraison | Déploiement Vercel, base Supabase, pg_cron, documentation | Requêtes GraphQL validées contre le schéma Admin 2026-10 |

Total : 39 tests automatisés + 1 test E2E navigateur, tous au vert.

## Limites connues
- **Non encore validé sur une boutique Shopify réelle** : nécessite l'app Shopify (étapes propriétaire). Points à valider en priorité : création de commande avec client et transaction COD, modification de commande (upsell 1-Click), rendu dans votre thème, OAuth Google, CAPI réel.
- Base partagée avec le projet Supabase existant (limite de 2 projets gratuits) — isolée par rôle et schéma.
- Vercel Hobby : réservé à un usage personnel ; dépassement de quota = coupure jusqu'au mois suivant.
- `orderCreate` : un seul code de remise (remises regroupées), pas de calcul de taxes, 5 commandes/min sur boutiques de développement.
- Pixels autres que Meta : navigateur uniquement. Multi-étapes, multilingue par formulaire, Omnisend/Klaviyo, Google Maps : backlog.

## Avertissement sécurité (projet Supabase existant)
L'advisor Supabase signale que la table `private.ai_settings` (application « copilote-mémoire », hors KB COD) a **RLS désactivée**. Correctif proposé, à appliquer seulement après vérification de son usage : `ALTER TABLE private.ai_settings ENABLE ROW LEVEL SECURITY;`

## Coûts
0 € engagé. Coûts futurs possibles uniquement sur décision : SMS/WhatsApp (fournisseur), revue Shopify (gratuite) si distribution publique.

## Actions propriétaire (≈ 30 min) — voir docs/GUIDE_INSTALLATION.md
1. Générer les secrets et activer le rôle `kbcod_app` + secret Vault (SQL fourni).
2. Créer l'app dans le Dev Dashboard Shopify, `shopify app deploy`, accès aux données client protégées, lien d'installation.
3. Renseigner les variables Vercel et redéployer.
4. (Facultatif) Client OAuth Google ; jeton CAPI Meta.

## Prochaine étape
Dès l'app installée : tests réels sur boutique de développement (commande, Sheets, Meta « Tester les événements », seconde boutique), corrections éventuelles, puis backlog (statut Sheets mis à jour, API serveur TikTok, multi-étapes).
