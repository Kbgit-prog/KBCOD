# Déploiement et maintenance

## Ressources créées (26/11/2026)
| Ressource | Identifiant | Coût |
|---|---|---|
| Projet Vercel `kbcod-manager` (équipe SOS MEMO, Hobby) | `prj_lwLY4Ab7OUdbrwW92WoLTUImIcCU`, https://kbcod-manager.vercel.app | 0 € |
| Schéma `kbcod` + rôle `kbcod_app` dans le projet Supabase « Kbgit-prog's Project » | `plysnvrltuzwzgxjnxed` (eu-west-1, Free) | 0 € |
| Extensions `pg_cron`, `pg_net` + tâches `kbcod-jobs` (chaque minute) et `kbcod-maintenance` (03:17 UTC) | même projet | 0 € |
| Secret Vault `kbcod_app_url` | même projet | 0 € |

## Déployer une nouvelle version
- Le projet Vercel est relié au dépôt GitHub : un *push* sur la branche de production (`main`) déploie automatiquement. Build : `npm run build:vercel` (admin Vite + script vitrine + fonction unique, sortie `.vercel/output`).
- Extension de thème / scopes / webhooks : `npm run build:storefront && shopify app deploy` (pour chaque app/boutique).
- Migrations de base : ajouter `migrations/00X_*.sql` (idempotent), puis `DATABASE_URL=… npm run migrate` (rôle `kbcod_app`).

## Vérifications après déploiement
1. `GET /health?db=1` → `{"ok":true,"db":"ok"}`.
2. Ouvrir l'app dans Shopify → tableau de bord sans alerte.
3. Commande test → Shopify (paiement en attente), Sheets « synchronisée », Meta « envoyé ».

## Surveillance (hebdomadaire, 5 min)
- Tableau de bord KB : alertes Sheets/Meta/commandes incertaines.
- Paramètres > File de travaux : statut « Abandonné » = intervention requise (bouton *Relancer* après correction).
- Vercel > Usage : rester sous les quotas Hobby (une coupure bloquerait les commandes jusqu'au mois suivant).
- Supabase > Database > taille (< 500 Mo) ; la purge quotidienne applique la durée de conservation.
- Versions d'API : Shopify publie une version par trimestre (support 12 mois). Mettre à jour `SHOPIFY_API_VERSION` et `[webhooks] api_version` au moins une fois par an, puis `npm run schema:fetch && npm test`.

## Incidents
| Symptôme | Cause probable | Action |
|---|---|---|
| Le formulaire n'apparaît pas | App embed désactivé ou config non publiée | Activer l'embed ; enregistrer un formulaire (republie) |
| « Boutique non configurée » | App non ouverte depuis l'installation | Ouvrir l'app une fois dans l'admin |
| Commandes « incertaines » | Délai Shopify | Réconciliation automatique ; bouton *Réconcilier* |
| Sheets « intervention requise » | Jeton révoqué, fichier/onglet/colonne modifié | Corriger puis *Relancer les échecs* |
| Meta code 190 | Jeton CAPI invalide | Regénérer le jeton dans Meta, l'enregistrer dans KB |
| `/health?db=1` en erreur | Mot de passe/URL base, projet Supabase en pause | Vérifier `DATABASE_URL` ; relancer le projet dans Supabase |
