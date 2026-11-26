# Architecture — KB COD Manager

## 1. Décision d'hébergement (coût : 0 €)

| Option | Avantages | Limites bloquantes / risques | Verdict |
|---|---|---|---|
| **Vercel Hobby** (fonctions Node) | Gratuit, HTTPS, déploiement Git, `waitUntil`, 300 s max/fonction | Conditions : usage personnel non commercial (accepté par le propriétaire, usage interne) ; cron Hobby limité à 1/jour ; en cas de dépassement de quota, fonction coupée jusqu'au mois suivant | **Retenu** (serveur) |
| **Supabase Free** (Postgres) | 500 Mo, pg_cron, pg_net, Vault inclus | 2 projets actifs max (atteint) ; mise en pause après 7 jours sans activité ; pas de sauvegarde téléchargeable sur l'offre gratuite | **Retenu** (base), schéma dédié dans un projet existant |
| Cloudflare Workers Free + D1 | 100 k requêtes/jour, D1 5 Go | 10 ms CPU/requête (risqué pour le chiffrement + rendu), Queues payantes | Alternative future |
| Neon Free | Pas de pause définitive | Compte supplémentaire à créer | Alternative si Supabase pose problème (changer `DATABASE_URL`) |

**Choix appliqués**
- Base : projet Supabase existant `plysnvrltuzwzgxjnxed` (eu-west-1), **schéma isolé `kbcod`** + **rôle dédié `kbcod_app`** (propriétaire de ses seules tables, aucun accès aux autres tables, schéma non exposé par l'API REST). Créer un 3ᵉ projet gratuit était refusé par Supabase (limite de 2 projets actifs).
- Serveur : projet Vercel `kbcod-manager` (région `dub1`, proche de la base), une seule fonction (limite Hobby de 12 fonctions respectée).
- File de travaux : table Postgres + **pg_cron chaque minute** → `POST /cron/jobs` (contourne la limite cron de Vercel Hobby et maintient l'activité Supabase, évitant la mise en pause).
- Coûts restants possibles : SMS/WhatsApp (fournisseur), rien d'autre.

## 2. Vue d'ensemble

```
Boutique (thème)  ──►  Extension de thème (App embed / bloc)  ──►  kbcod.js (Shadow DOM)
                                                                    │  POST /sf/submit, /sf/track, /sf/partial
Admin Shopify (iframe) ── App Bridge (jeton de session) ──► /api/admin/*            │
                                                                    ▼
                                         Vercel : Hono (Node 22) ── PostgreSQL (schéma kbcod)
                                              │      ▲                     ▲
                       Admin GraphQL 2026-10 ─┘      └── pg_cron (1/min) ──┘
                       Google Sheets API · Meta CAPI · Twilio / WhatsApp Cloud API
```

- **Admin** : React (Vite) servi en statique sur `/app/<client_id>`, App Bridge (CDN Shopify), appels authentifiés par jeton de session (JWT HS256 signé avec le secret de l'app).
- **Installation gérée par Shopify** (scopes dans `shopify.app.toml`) + **échange de jeton** → jeton d'accès hors ligne chiffré (AES-256-GCM). Jetons expirants (refresh) gérés.
- **Vitrine** : configuration publiée dans un métachamp de l'installation (`app.metafields.kbcod.config`), lue par Liquid sans appel réseau ; repli sur `GET /sf/config`.
- **Multi-apps** : `SHOPIFY_API_KEY` + `SHOPIFY_EXTRA_APPS` permettent une app (distribution personnalisée) par boutique avec un seul serveur : JWT identifié par `aud`, webhooks par HMAC testé sur chaque secret.

## 3. Création des commandes COD

- Mutation **`orderCreate`** (Admin GraphQL 2026-10, validée hors ligne contre le schéma officiel) avec `financialStatus: PENDING` et, en option, une transaction `SALE` **`PENDING`** « Cash on Delivery (COD) » : la commande n'est **jamais** marquée payée.
- Prix, disponibilité et variantes **relus dans Shopify** à chaque envoi (`nodes(ids:)`), calcul serveur unique (`src/shared/pricing.ts`) ; remises regroupées en un `itemFixedDiscountCode` (orderCreate n'accepte qu'un code).
- `inventoryBehaviour: DECREMENT_OBEYING_POLICY` par défaut (pas de survente).
- Limite Shopify : 5 créations/min sur boutiques de développement/essai (documentée par Shopify).

### Idempotence et anti-doublon
1. Le navigateur génère un `submissionId` (UUID) à l'ouverture ; il est réutilisé pour tous les renvois.
2. `submissions.id` est la clé : un envoi déjà traité renvoie le même résultat ; « processing » si en cours.
3. Verrou consultatif Postgres par téléphone pendant l'évaluation antifraude + réservation (double clic, envois parallèles).
4. `sourceIdentifier = kbcod-<submissionId>` sur la commande. Réponse perdue (réseau) → statut **incertain** → travail `order.reconcile` qui **recherche d'abord** la commande (`orders(query:"source_identifier:…")`) avant toute recréation.
5. Erreurs `userErrors` = aucune commande créée → nouvelle tentative sûre (sans client, puis sans transaction).

## 4. File de travaux durable
Table `jobs` : clé de déduplication unique, `FOR UPDATE SKIP LOCKED`, reprise des verrous > 5 min, délais 30 s → 24 h, statut `dead` (intervention requise) après 8 essais, relance manuelle depuis l'admin. Déclenchement : `waitUntil` juste après la commande, webhooks, pg_cron chaque minute.

Types : `sheets.sync`, `meta.stage`, `notify.order`, `order.reconcile`, `abandoned.check`.

## 5. Google Sheets
OAuth par boutique (scope `spreadsheets` + `openid email`), jetons chiffrés, choix du fichier par lien ou création, choix de l'onglet, mapping **par en-tête de colonne** (ligne 1), une ligne par commande ou par produit, `values.append` + `INSERT_ROWS` + `RAW` (jamais d'écrasement, pas d'injection de formule). Anti-doublon : table `sheet_syncs` unique par commande + vérification de la colonne « N° commande » après une tentative incertaine. Statuts : en attente, en cours, synchronisé, échec temporaire, intervention requise. Jeton révoqué (`invalid_grant`), fichier supprimé (404), onglet renommé (400), colonne absente → *intervention requise* ; reconnexion → relance automatique.

## 6. Meta Pixel + CAPI — voir `docs/META_EVENEMENTS.md`

## 7. Antifraude
Fenêtres glissantes calculées depuis l'instant de la tentative (`created_at > now() - fenêtre`), identifiants : téléphone (E.164), IP, IP+téléphone, navigateur, e-mail ; actions : refuser, OTP, signaler (étiquette). Les soumissions en cours/incertaines comptent. Listes noire/blanche (empreintes HMAC salées, préfixes), champ piège, délai minimal, tentatives par IP/10 min, Turnstile facultatif, indicatifs autorisés, quantité max. IP fournie par `x-real-ip` (Vercel, non falsifiable). Règle IP par défaut = *signaler* (IP partagées).

## 8. Modèle de données (schéma `kbcod`)
`shops` (frontière d'isolation, jetons chiffrés, paramètres JSON validés Zod) · `forms`, `form_versions` (50 versions), `form_products` · `offers` · `submissions` (clé d'idempotence, devis, statut, empreintes) · `attempts`, `list_entries`, `fraud_events`, `otp_challenges` · `jobs` · `google_connections`, `sheet_syncs` · `pixels`, `tracking_events` · `abandoned` · `message_logs` · `stats_daily` · `audit_log` · `webhook_receipts`. Toutes les tables métier portent `shop_id` ; chaque requête filtre sur la boutique authentifiée. RLS activée sans politique (aucun accès `anon`/`authenticated`).

## 9. Sécurité
Secrets uniquement côté serveur (variables Vercel), chiffrement AES-256-GCM des jetons (Shopify, Google, Meta, SMS, WhatsApp), HMAC des webhooks (comparaison à temps constant), JWT de session vérifié (signature, `aud`, `exp`, `nbf`, `dest`), CSP `frame-ancestors`, validation Zod de toutes les entrées, CSS personnalisé validé (pas de JavaScript, `@import`, `expression`, `javascript:`), rendu vitrine sans `innerHTML` de contenu marchand, journaux sans données personnelles (clés sensibles masquées), webhooks RGPD (`customers/redact`, `shop/redact`, `customers/data_request`), purge selon durée de conservation.

## 10. Risques
| Risque | Mesure |
|---|---|
| Quota Vercel Hobby dépassé → coupure | Volume personnel faible ; une seule fonction ; surveiller l'usage Vercel |
| Pause Supabase | Activité quotidienne via pg_cron ; procédure de restauration (dashboard) |
| Base partagée avec un autre projet | Rôle et schéma isolés ; migration vers projet dédié = changer `DATABASE_URL` + `pg_dump` |
| IP d'App Proxy non fiable | Non utilisé : appel direct au serveur (IP Vercel fiable) |
| Distribution multi-boutiques | Une app personnalisée par boutique (même serveur) ou app publique non listée (revue Shopify) |
| Multidevise (Markets) | Commandes en devise de la boutique ; prix Liquid affichés = estimation, total serveur fait foi |
| Taxes non calculées par `orderCreate` | Option « prix TTC » ; marché CI généralement sans taxe affichée |
