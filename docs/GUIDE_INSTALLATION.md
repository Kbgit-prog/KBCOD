# Guide d'installation — KB COD Manager

État au 26/11/2026 : serveur déployé sur **https://kbcod-manager.vercel.app** (Vercel Hobby, région Dublin), base créée (schéma `kbcod` du projet Supabase `plysnvrltuzwzgxjnxed`), déclencheur minute pg_cron installé. **Restent les étapes réservées au propriétaire** (secrets et comptes), environ 30 minutes.

## Étape 1 — Générer les secrets (2 min)
Dans Supabase > projet « Kbgit-prog's Project » > **SQL Editor**, exécutez :
```sql
select 'ENCRYPTION_KEY' k, encode(extensions.gen_random_bytes(32), 'base64') v
union all select 'HASH_SALT', encode(extensions.gen_random_bytes(24), 'hex')
union all select 'CRON_SECRET', encode(extensions.gen_random_bytes(32), 'hex')
union all select 'DB_PASSWORD', encode(extensions.gen_random_bytes(24), 'hex');
```
Copiez les 4 valeurs dans un gestionnaire de mots de passe. (Alternative : `node scripts/generate-secrets.mjs`.)
⚠️ Ne changez jamais `ENCRYPTION_KEY` ensuite : les jetons enregistrés deviendraient illisibles.

## Étape 2 — Activer l'accès base de données (2 min)
Toujours dans le SQL Editor (remplacez les valeurs) :
```sql
ALTER ROLE kbcod_app WITH LOGIN PASSWORD 'VOTRE_DB_PASSWORD';
SELECT vault.create_secret('VOTRE_CRON_SECRET', 'kbcod_cron_secret', 'Secret cron KB COD');
```
Chaîne de connexion : Supabase > **Connect** > *Transaction pooler* (port **6543**). Remplacez l'utilisateur `postgres.plysnvrltuzwzgxjnxed` par **`kbcod_app.plysnvrltuzwzgxjnxed`** et le mot de passe par `DB_PASSWORD`. Exemple :
`postgresql://kbcod_app.plysnvrltuzwzgxjnxed:DB_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`

## Étape 3 — Créer l'application Shopify (10 min)
1. https://dev.shopify.com/dashboard → **Create app** → nom « KB COD Manager ». Notez **Client ID** et **Client secret**.
2. Sur un ordinateur avec Node.js 20+ :
   ```bash
   git clone https://github.com/Kbgit-prog/KBCOD.git && cd KBCOD && npm ci
   npm i -g @shopify/cli
   ```
3. Dans `shopify.app.toml`, remplacez `REMPLACER_PAR_CLIENT_ID` (2 fois) par le Client ID et `REMPLACER-PAR-VOTRE-DOMAINE.vercel.app` par `kbcod-manager.vercel.app`.
4. `npm run build:storefront && shopify app deploy` → publie scopes, webhooks, URL et l'**extension de thème**.
5. Dev Dashboard > votre app > **API access / Protected customer data** : demandez l'accès aux champs *nom, e-mail, téléphone, adresse* (nécessaire pour créer des commandes avec client et recevoir les webhooks de commande).
6. **Distribution** > *Custom distribution* > domaine de la boutique (`xxx.myshopify.com`) > copiez le lien d'installation.

## Étape 4 — Variables Vercel (5 min)
Vercel > projet **kbcod-manager** > Settings > **Environment Variables** (Production), type *Sensitive* pour les secrets :

| Clé | Valeur |
|---|---|
| `APP_URL` | `https://kbcod-manager.vercel.app` |
| `DATABASE_URL` | chaîne de l'étape 2 |
| `ENCRYPTION_KEY`, `HASH_SALT`, `CRON_SECRET` | étape 1 |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Client ID / Client secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | étape 5 (facultatif au début) |

Puis **Deployments > ⋯ > Redeploy**. Contrôle : `https://kbcod-manager.vercel.app/health?db=1` doit afficher `"db":"ok"`.

## Étape 5 — Google Sheets (10 min, gratuit)
1. https://console.cloud.google.com → nouveau projet « KB COD ».
2. *APIs & Services > Library* → activez **Google Sheets API**.
3. *OAuth consent screen* : type **External**, nom de l'app, e-mail ; ajoutez le scope `.../auth/spreadsheets` ; puis **Publish app** (statut *In production*). En statut *Testing*, Google expire les autorisations après 7 jours. Sans vérification Google, l'écran affiche « application non vérifiée » : cliquez *Paramètres avancés > Continuer* (usage personnel, jusqu'à 100 utilisateurs).
4. *Credentials > Create credentials > OAuth client ID* → *Web application* → URI de redirection autorisée : `https://kbcod-manager.vercel.app/google/callback`.
5. Copiez Client ID / secret dans Vercel (étape 4) et redéployez.

## Étape 6 — Installer sur la boutique
1. Ouvrez le lien d'installation (étape 3.6) → **Installer**. L'app s'ouvre dans l'admin Shopify ; la boutique est enregistrée et le formulaire principal publié.
2. Tableau de bord KB COD > **Activer « KB COD Manager » (App embed)** → *Enregistrer* dans l'éditeur de thème. Option : ajoutez le bloc **Formulaire COD** dans la section produit pour choisir l'emplacement exact.
3. Passez une commande test sur un produit : elle doit apparaître dans Shopify avec le statut de paiement **En attente** et les étiquettes `KBCOD, COD`.

## Étape 7 — Meta (facultatif)
Gestionnaire d'événements Meta > votre pixel > Paramètres > **Générer un jeton d'accès** (Conversions API). Dans KB COD > Pixels & Tracking : ID du pixel + jeton (+ code de test pour vérifier). Voir `docs/META_EVENEMENTS.md`.

## Ajouter une autre boutique
La distribution personnalisée Shopify ne permet qu'**une boutique** (ou une organisation Plus) par app. Deux options gratuites :
- **A (recommandée, sans revue)** : une app par boutique, même serveur. Créez une nouvelle app (étape 3) ; dans le dépôt : `shopify app config link` (crée `shopify.app.<nom>.toml`), remplacez l'URL par `https://kbcod-manager.vercel.app/app/<NOUVEAU_CLIENT_ID>`, `shopify app deploy --config <nom>`. Ajoutez dans Vercel `SHOPIFY_EXTRA_APPS=[{"clientId":"…","clientSecret":"…","name":"Boutique 2"}]` et redéployez.
- **B** : passer l'app en *Public distribution* non listée (une seule app pour toutes les boutiques) — nécessite la revue Shopify.
Chaque boutique a ses propres formulaires, règles, Google, pixels et journaux (isolation par boutique).

## Développement local
```bash
cp .env.example .env   # renseigner une base PostgreSQL locale
npm ci && npm run migrate && npm run seed:dev
npm run build && npm run dev        # http://localhost:3000/health
npm test                            # tests unitaires/intégration (PostgreSQL local requis)
npm run test:e2e                    # test navigateur du script vitrine (Playwright)
npm run schema:fetch                # schéma Admin GraphQL pour valider les requêtes
```
