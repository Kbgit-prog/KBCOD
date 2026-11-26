# Matrice de parité EasySell / KB COD Manager

Sources : voir `docs/RECHERCHE_EASYSELL.md` (S1–S6). Vérif. EasySell : C = confirmé, T = tiers, V = à vérifier.
Statut KB : **IMPL** implémenté · **TEST-A** test automatisé · **TEST-B** testé en navigateur (Chromium) · **À VALIDER** test sur boutique réelle restant · **LIMITÉ** limitation technique · **BACKLOG**.
Aucune fonction n'est encore validée sur une boutique Shopify réelle (en attente des identifiants de l'app : voir guide d'installation).

## Formulaire (priorité 1)

| Fonctionnalité | Source | Vérif. | Exigence KB | Prio | Statut KB | Test d'acceptation |
|---|---|---|---|---|---|---|
| Popup / Embedded | S3 | C | Choix par formulaire | P1 | IMPL, TEST-B | Popup s'ouvre, Embedded affiché dans la page |
| Formulaire principal + formulaires par produit | S6 | C | Défaut boutique + affectation produits | P1 | IMPL, TEST-A | Produit associé → formulaire spécifique, sinon principal |
| Bibliothèque de champs (23 types) | S3, S6 | C | Aucun champ figé | P1 | IMPL, TEST-B | Ajout/suppression/déplacement/masquage |
| Champs obligatoires, libellés, placeholders, messages d'erreur, longueur min/max, options | S6 | C | Par champ | P1 | IMPL, TEST-A (validation serveur) | Erreurs affichées et refusées côté serveur |
| Champs conditionnels | — | V | Facultatif | P1 | IMPL | Champ affiché si condition remplie |
| Adresse en saisie libre | Cahier | — | Aucune liste imposée | P1 | IMPL | Texte libre accepté |
| Pays desservis | S3 | C | Liste + défaut | P1 | IMPL, TEST-A | Pays hors liste refusé |
| Contenu panier (variante, quantité, image, prix) | S3, S6 | C | Bloc déplaçable | P1 | IMPL, TEST-B | Variante change le prix |
| Compte à rebours, titre, texte, image, séparateur, espace | S6 | V | Blocs | P1 | IMPL | Affichage |
| Résumé de commande | S3 | C | Sous-total, remises, livraison, total | P1 | IMPL, TEST-B | Totaux corrects |
| Bouton fixe (sticky) | S6 | V | Mobile seul / haut-bas | P1 | IMPL | Visible hors formulaire |
| Masquer Ajouter au panier / Acheter maintenant | S6 | V | Options | P1 | IMPL, TEST-B | Boutons masqués |
| Ouverture par sélecteur CSS (PageFly, GemPages) | S3, S5 | C | Sélecteur libre | P1 | IMPL | Clic ouvre la popup |
| Design : modèles, couleurs, polices, tailles, bordures, ombres, espacements, boutons, animations, RTL | S6 | C | Tous réglages | P1 | IMPL, TEST-B | Aperçu reflète chaque réglage |
| Aperçu direct mobile/ordinateur | S6 | C | Oui | P1 | IMPL, TEST-B | Mise à jour immédiate |
| CSS personnalisé validé, activable, par formulaire, isolé | Cahier | — | Sans JavaScript | P1 | IMPL, TEST-B | Erreurs de syntaxe signalées |
| Messages personnalisables | S6 | C | 17 messages | P1 | IMPL | — |
| Rupture de stock | S6 | V | Désactiver/masquer/autoriser | P1 | IMPL, TEST-A | Rupture refusée côté serveur |
| Redirection après commande | — | V | Message / statut Shopify / URL | P1 | IMPL | — |
| Dupliquer, restaurer, versions | Cahier | — | 50 versions | P1 | IMPL, TEST-B | Restauration crée une version |
| Multi-étapes | S2 | T | — | P3 | BACKLOG | — |
| Multilingue | S1 | T | Textes libres par formulaire (1 langue/formulaire) | P2 | LIMITÉ | Traductions multiples : backlog |
| Bouton « Shopify Checkout » | S3 | C | — | P3 | BACKLOG (hors COD) | — |

## Commandes (priorité 5 / intégrité)

| Fonctionnalité | Exigence | Statut | Test |
|---|---|---|---|
| Création via Admin GraphQL `orderCreate`, statut **PENDING** | Jamais « payé » | IMPL, TEST-A | `financialStatus=PENDING`, transaction PENDING |
| Prix/variantes relus côté serveur | Prix navigateur ignorés | IMPL, TEST-A | Variante d'un autre produit refusée |
| Double clic / renvoi / requêtes parallèles | 1 seule commande | IMPL, TEST-A, TEST-B | 3 envois simultanés → 1 commande |
| Réponse perdue → réconciliation | Pas de doublon | IMPL, TEST-A | Recherche `source_identifier` avant recréation |
| Frais de livraison personnalisés | Par pays, montant, gratuité | IMPL, TEST-A (calcul) | — |
| Codes promo KB | Vérifiés serveur | IMPL | — |
| Stock (politique Shopify) | Décrément sans survente | IMPL | À VALIDER sur boutique |
| Taxes | — | LIMITÉ (orderCreate ne calcule pas) | Option TTC |

## Offres

| Fonctionnalité | Source | Statut |
|---|---|---|
| Quantity offers (paliers, badges, images, livraison offerte, masquage quantité) | S3 C | IMPL, TEST-A, TEST-B |
| 1-Tick upsells (position par bloc) | S3 C | IMPL |
| Downsell à la fermeture | S3 C | IMPL |
| 1-Click post-commande (modification de commande, pas de 2ᵉ commande) | S3 C | IMPL, mutations validées sur le schéma ; À VALIDER sur boutique |
| Bundles Shopify (« components ») | S3 C (non supporté chez EasySell) | LIMITÉ (idem) |
| Recommandation IA | T | Hors périmètre |

## Antifraude (priorité 3)

| Fonctionnalité | Source | Statut |
|---|---|---|
| Limites téléphone / IP / e-mail / navigateur / IP+téléphone | S3 C | IMPL, TEST-A |
| Fenêtre glissante (ex. 2 / 72 h) | Cahier | IMPL, TEST-A (bornes 71,9 h / 72,1 h) |
| Quantité max par commande | S3 C | IMPL, TEST-A |
| Liste noire / blanche, préfixes, expiration, historique | S3 C | IMPL, TEST-A |
| Robots : champ piège, délai minimal, tentatives/IP, Turnstile | — | IMPL, TEST-A |
| OTP SMS / WhatsApp, étiquette « vérifié » | S3 C | IMPL ; envoi réel À VALIDER (fournisseur payant) |
| Faux positifs IP partagée | Cahier | IMPL (IP = signaler), TEST-A |
| Code postal | T | BACKLOG (limite par indicatif disponible) |

## Google Sheets (priorité 2)

| Fonctionnalité | Statut |
|---|---|
| OAuth par boutique, changement de compte, révocation | IMPL ; À VALIDER (client OAuth Google requis) |
| Fichier par lien ou création, choix d'onglet | IMPL |
| Mapping par en-tête, champs personnalisés, valeur fixe | IMPL, TEST-A |
| Ligne par commande / par produit | IMPL, TEST-A |
| File persistante, retries, statuts, relance, anti-doublon | IMPL, TEST-A |
| Jeton expiré / fichier supprimé / onglet renommé / colonne absente | IMPL, TEST-A (jeton, colonne) |
| Commande jamais perdue si Google indisponible | IMPL, TEST-A |
| Mise à jour du statut de la ligne (confirmée, expédiée) | BACKLOG |

## Pixels (priorité 4)

| Fonctionnalité | Source | Statut |
|---|---|---|
| Meta Pixel + CAPI, plusieurs pixels, jeton chiffré, code test | S3 C | IMPL, TEST-A, TEST-B |
| Déduplication `event_name` + `event_id` | Cahier | IMPL, TEST-A, TEST-B |
| Étapes COD distinctes (soumise / confirmée / expédiée / payée) | Cahier | IMPL, TEST-A |
| Journal, diagnostic, retries | Cahier | IMPL, TEST-A |
| TikTok, Snap, Pinterest, Google Ads, GA4 | S3 C | IMPL (navigateur, si script présent) ; API serveur : BACKLOG |
| Taboola, ShareChat, Kwai | V | BACKLOG |

## Autres

| Fonctionnalité | Source | Statut |
|---|---|---|
| Commandes abandonnées (délai configurable, consentement, relance) | S3 C | IMPL (stockées dans KB, pas en brouillon Shopify) |
| Intégrations Omnisend / Klaviyo | S3 C | BACKLOG (webhook SMS générique disponible) |
| SMS / WhatsApp (confirmation, expédition, relance), fournisseurs interchangeables | S3 C | IMPL ; envoi réel À VALIDER |
| Analytics (affichages, ouvertures, commandes, conversion, panier moyen, bloquées, abandons) | S1 T | IMPL |
| Sauvegarde / restauration de configuration (sans secrets) | Cahier | IMPL |
| Multi-boutiques isolées | Cahier | IMPL, TEST-A |
| RGPD Shopify (redact, data_request) | Shopify | IMPL, TEST-A |
| Paiements partiels | T | Hors périmètre initial (cahier §18) |
| Autocomplétion Google Maps | Cahier | BACKLOG (payant au-delà du quota gratuit ; autocomplétion navigateur disponible) |
