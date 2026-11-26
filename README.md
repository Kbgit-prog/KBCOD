# KB COD Manager

Application Shopify de formulaires de commande **paiement à la livraison (COD)** : constructeur de formulaires, commandes Shopify fiables, antifraude, Google Sheets, Meta Pixel + Conversions API, offres/upsells, abandons, SMS/WhatsApp. Multi-boutiques, hébergement gratuit (Vercel Hobby + Supabase Free).

- Serveur : https://kbcod-manager.vercel.app (`/health`)
- Cahier des charges : `docs/CAHIER_DES_CHARGES_KB_COD_MANAGER.md`

## Documentation
| Document | Contenu |
|---|---|
| [GUIDE_INSTALLATION](docs/GUIDE_INSTALLATION.md) | Secrets, base, app Shopify, Vercel, Google, installation, 2ᵉ boutique |
| [GUIDE_CONFIGURATION](docs/GUIDE_CONFIGURATION.md) | Chaque écran de l'admin, réglages recommandés |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Hébergement gratuit, commandes, file durable, sécurité, données, risques |
| [META_EVENEMENTS](docs/META_EVENEMENTS.md) | Événements COD, déduplication, tests Meta |
| [RECHERCHE_EASYSELL](docs/RECHERCHE_EASYSELL.md) / [MATRICE_PARITE](docs/MATRICE_PARITE_FONCTIONNELLE.md) | Audit fonctionnel et statut de chaque fonction |
| [SAUVEGARDE_RESTAURATION](docs/SAUVEGARDE_RESTAURATION.md) | Export, pg_dump, migration, désinstallation |
| [DEPLOIEMENT_MAINTENANCE](docs/DEPLOIEMENT_MAINTENANCE.md) | Ressources créées, déploiement, surveillance, incidents |
| [RAPPORT_AVANCEMENT](docs/RAPPORT_AVANCEMENT.md) | Ce qui est livré, testé, limites, actions restantes |

## Structure
```
src/shared/      schémas (Zod) du formulaire et des offres, calcul des prix, validation CSS
src/server/      API Hono : auth Shopify, commandes, antifraude, Sheets, Meta, file de travaux, webhooks
src/admin/       interface d'administration React (intégrée à Shopify via App Bridge)
src/storefront/  rendu du formulaire (Shadow DOM) et script vitrine
extensions/kbcod-theme/  extension de thème (App embed + bloc « Formulaire COD »)
migrations/      SQL de l'application · supabase/ préparation Supabase (rôle, cron)
tests/           Vitest (PostgreSQL réel) + E2E Playwright
```

## Commandes
```bash
npm ci
npm test              # 39 tests (PostgreSQL local, voir .env.example)
npm run test:e2e      # navigateur réel, script vitrine
npm run build:vercel  # sortie Vercel (.vercel/output)
npm run migrate       # migrations (DATABASE_URL)
```
