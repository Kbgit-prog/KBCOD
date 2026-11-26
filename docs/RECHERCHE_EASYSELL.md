# Recherche fonctionnelle — EasySell COD Form & Upsells

**Date :** 26/11/2026 — **Auteur :** audit technique KB COD Manager
**Méthode :** recherches web (App Store Shopify, site éditeur, centre d'aide Tyslo, comparatifs tiers).
**Limite :** depuis l'environnement de développement, l'accès direct à `apps.shopify.com`, `easysellapp.com` et `help.tyslo.com` était bloqué par le réseau ; les informations proviennent des extraits indexés par le moteur de recherche. Les fonctions non documentées publiquement sont marquées **À VÉRIFIER**. Aucun code, visuel ou texte d'EasySell n'a été copié.

Légende : **CONFIRMÉ** (source officielle éditeur) · **TIERS** (source tierce concordante) · **À VÉRIFIER** · **HYPOTHÈSE**.

## 1. Sources

| # | Source | Type |
|---|---|---|
| S1 | apps.shopify.com/easy-order-form (fiche App Store, avis) | Officielle |
| S2 | easysellapp.com (site + blog « wiki ») | Éditeur |
| S3 | help.tyslo.com (centre d'aide Tyslo / EasySell) | Éditeur |
| S4 | analyzify.com, hulkapps.com, carthook.com, softpulseinfotech.com, pickyourapp.com, open.store | Tiers |
| S5 | help.gempages.net (intégration GemPages) | Partenaire |
| S6 | Vidéo fournie par le propriétaire (référencée par le cahier des charges) | Propriétaire |

## 2. Produit et tarifs

| Élément | Constat | Statut |
|---|---|---|
| Éditeur | Tyslo | CONFIRMÉ (S1, S3) |
| Note | ~4,7–4,9/5, 700 à 950 avis selon la source | TIERS |
| Plan gratuit | ~60 commandes/mois, upsells, OTP, analytics inclus | TIERS (S4) |
| Plan Pro | ~9,95 $/mois, 360 à 440 commandes selon la source | TIERS (sources contradictoires) |
| Plan Unlimited | 24,95 $ à 59,95 $/mois selon la source | TIERS (contradictoire) |
| SMS | Facturés en supplément sur tous les plans | TIERS (S4) |

**Conséquence KB :** aucun plafond de commandes ; seuls les SMS/WhatsApp restent payants chez le fournisseur choisi.

## 3. Fonctionnalités relevées

### 3.1 Constructeur de formulaire (Form Builder)
- Onglets *type de formulaire, pays, champs, style* ; choix **Popup** ou **Embedded** au clic sur le bouton d'achat — CONFIRMÉ (S3).
- Liste des **pays** où le COD est disponible — CONFIRMÉ (S3).
- « Add new fields » dans la section Formulaire, onglet **Custom fields** (contient le champ 1-Tick Upsell) — CONFIRMÉ (S3).
- Bloc **Cart Content** contenant les offres de quantité ; déplacer le bloc déplace les offres — CONFIRMÉ (S3).
- Sélecteur de quantité masqué si une offre de quantité est active — CONFIRMÉ (S3).
- Champ **Order Summary** pour afficher la réduction du downsell — CONFIRMÉ (S3).
- Champ Shopify **Shipping options** pour afficher les tarifs de livraison — CONFIRMÉ (S3).
- Formulaire **multi-étapes** avec indicateur de progression — TIERS (blog éditeur, S2) / À VÉRIFIER dans l'app.
- Glisser-déposer, multilingue, multidevise — TIERS (S1, S4).
- Ouverture du formulaire depuis un bouton personnalisé via **ID ou classe CSS** (PageFly/GemPages) — CONFIRMÉ (S3, S5).
- Bouton **Shopify Checkout** dans le formulaire (paiement en ligne pré-rempli) — CONFIRMÉ (S3).
- Compte à rebours, texte d'introduction, bouton fixe (sticky), RTL : vus dans la vidéo du propriétaire (S6) / À VÉRIFIER pour le détail des options.

### 3.2 Offres
- **Quantity offers** (paliers, image par URL de Shopify Files) — CONFIRMÉ (S3).
- **1-Tick Upsells** dans le formulaire, position réglable — CONFIRMÉ (S3).
- **Upsells post-commande (1-Click)** — CONFIRMÉ (S3 catégorie « Upsells & Downsells »).
- **Downsell** : popup à la fermeture du formulaire, tous produits ou produits ciblés, remise fixe ou % — CONFIRMÉ (S3).
- Bundles Shopify (« variant with components ») non supportés par défaut — CONFIRMÉ (S3).
- Recommandation de produits par IA (plans supérieurs) — TIERS / hors périmètre.

### 3.3 Antifraude
- **Order Blocker** : limite des commandes répétées par **IP, téléphone ou e-mail** sur une période ; plafond du nombre de commandes et de la quantité par commande ; liste d'IP bloquées ; exemption des commandes de test — CONFIRMÉ (S3, réglages > Fraud Protection).
- **OTP** SMS à 4 chiffres ; étiquette `EASYSELL_VERIFIED` ; option « créer la commande seulement après vérification » — CONFIRMÉ (S3).
- Limitation par code postal — TIERS (S4).

### 3.4 Commandes abandonnées
- Activation dans Réglages > Général ; abandon = téléphone ou e-mail saisi sans envoi dans les **15 minutes** ; créées comme **brouillons de commande** avec l'étiquette `easysell-abandoned-checkout` ; relance via Omnisend/Klaviyo — CONFIRMÉ (S3). Délai configurable : À VÉRIFIER (non documenté).

### 3.5 Google Sheets
- Export en temps réel après connexion d'un compte Google — CONFIRMÉ (S3, article court renvoyant à une vidéo).
- Seules les commandes passées par le formulaire sont exportées (pas celles du checkout Shopify) — CONFIRMÉ (S3).
- Détail du mapping de colonnes, ligne par produit : À VÉRIFIER.

### 3.6 Pixels
- Réglages > Tracking : **Facebook Pixel, Facebook Conversions API, TikTok, Snap, Pinterest, Google Tag, Google Ads** ; détection des pixels déjà présents dans Shopify — CONFIRMÉ (S3).
- Taboola, ShareChat, Kwai (cités dans le cahier des charges) — À VÉRIFIER.
- Comportement exact de la déduplication EasySell — non documenté publiquement.

### 3.7 Autres
- Paiements partiels (acompte) — TIERS (S2) / hors périmètre initial (cahier des charges §18 : COD d'abord).
- Livraison : tarifs personnalisés recommandés plutôt que les tarifs Shopify — CONFIRMÉ (S3).
- Intégrations : GemPages, PageFly (constructeurs de pages), Omnisend, Klaviyo — CONFIRMÉ (S3).

## 4. Avis et problèmes fréquents
- Avis majoritairement positifs, support très réactif — TIERS (S1).
- Critiques minoritaires : bugs, fiabilité, coût, prise en main — TIERS (S1, S4).
- Aucune plainte publique spécifique trouvée sur les doublons, Sheets ou pixels ; à surveiller dans les avis 1–2 étoiles — À VÉRIFIER.

## 5. Décisions KB COD Manager issues de l'audit
1. Constructeur libre (aucun champ figé, adresse en saisie libre), Popup/Embedded, sticky, déclencheur par sélecteur CSS.
2. Offres : quantité, 1-Tick, downsell à la fermeture, 1-Click post-commande (par **modification de commande**, pas de seconde commande).
3. Antifraude : fenêtres glissantes multi-identifiants, listes noire/blanche avec préfixes, robots (champ piège, délai, Turnstile), OTP désactivable.
4. Abandons : délai configurable (15 min par défaut), stockés dans KB (pas de brouillon Shopify, pour ne pas polluer l'admin) — écart volontaire, documenté.
5. Sheets : file persistante, mapping par en-tête, ligne par commande ou par produit, jamais d'écrasement.
6. Meta : Pixel + CAPI dédupliqués, étapes COD distinctes ; autres pixels côté navigateur.
7. Hors périmètre initial : paiements partiels, bouton Shopify Checkout, IA, multi-étapes (backlog).
