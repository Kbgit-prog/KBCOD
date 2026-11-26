# Sauvegarde et restauration

## Ce qui est sauvegardé où
| Donnée | Référence | Sauvegarde |
|---|---|---|
| Commandes, clients, produits | **Shopify** (fait foi) | Assurée par Shopify |
| Configuration (formulaires, offres, paramètres, pixels sans jetons, mapping Sheets) | Base KB | Export JSON depuis l'admin |
| Journaux, soumissions, statistiques | Base KB | `pg_dump` (ci-dessous) |
| Jetons (Shopify, Google, Meta, SMS) | Base KB, chiffrés | Jamais exportés ; se reconnecter après restauration |

## 1. Export de configuration (chaque boutique)
Admin KB > **Paramètres > Exporter la configuration** → fichier `kbcod-config-<boutique>-<date>.json`. Recommandé après chaque modification importante et chaque mois. Aucun secret ni donnée client dedans.

**Restauration** : *Paramètres > Importer…* (validation complète avant écriture). Le formulaire principal est remplacé (version précédente conservée dans l'onglet Versions), les autres formulaires et offres sont ajoutés.

## 2. Sauvegarde complète de la base (mensuelle)
L'offre gratuite Supabase ne fournit pas de sauvegarde téléchargeable. Sur votre ordinateur (client PostgreSQL 17) :
```bash
pg_dump "postgresql://kbcod_app.plysnvrltuzwzgxjnxed:DB_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  --schema=kbcod --no-owner -Fc -f kbcod-$(date +%F).dump
```
(Port **5432** = mode session, requis par `pg_dump`.) Conservez le fichier hors du dépôt Git (données personnelles).

**Restauration** (base vide ou nouveau projet) :
```bash
pg_restore --no-owner --role=kbcod_app -d "<DATABASE_URL session 5432>" kbcod-AAAA-MM-JJ.dump
```
Puis vérifier `/health?db=1`. La même `ENCRYPTION_KEY` doit être utilisée, sinon reconnecter Google/Meta et rouvrir l'app dans chaque boutique (le jeton Shopify est ré-obtenu automatiquement).

## 3. Migration vers une autre base PostgreSQL (Neon, nouveau projet Supabase)
1. Créer la base, exécuter `supabase/000_role_and_schema.sql` (ou créer un utilisateur propriétaire), puis `npm run migrate` ou `pg_restore`.
2. Changer `DATABASE_URL` dans Vercel → redéployer.
3. Recréer le déclencheur minute (`supabase/002_cron.sql` sur Supabase, ou un cron externe gratuit appelant `POST /cron/jobs` avec `Authorization: Bearer CRON_SECRET`).

## 4. Désinstallation
Désinstaller l'app dans Shopify → webhook `app/uninstalled` (jeton supprimé). Shopify envoie `shop/redact` 48 h plus tard → toutes les données de la boutique sont effacées de la base KB.
Suppression complète du serveur : supprimer le projet Vercel, puis dans Supabase :
```sql
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'kbcod-%';
DROP SCHEMA kbcod CASCADE; DROP ROLE kbcod_app;
DELETE FROM vault.secrets WHERE name IN ('kbcod_cron_secret','kbcod_app_url');
```
