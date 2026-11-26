# KB COD Manager — Cahier des charges maître

**Version :** 1.0 — **Statut :** spécification initiale à compléter par l'audit documentaire EasySell  
**Dépôt :** https://github.com/Kbgit-prog/KBCOD  
**Plateforme :** Shopify  
**Marché initial envisagé :** Côte d'Ivoire et e-commerce francophone africain

## 1. Mission confiée à Claude Code

Concevoir et développer une application Shopify indépendante appelée **KB COD Manager**, alternative fonctionnelle à EasySell COD Form & Upsells.

Agir comme une équipe produit et technique senior : architecture Shopify, frontend, backend, sécurité, Google Sheets, Meta Pixel/CAPI, QA et documentation.

**Ne pas commencer par coder l'ensemble de l'application.** Commencer par auditer le dépôt, effectuer les recherches exigées ci-dessous, produire les livrables de Phase 0 et faire valider l'architecture avant les opérations structurantes.

### Règles de travail

- Examiner l'intégralité du dépôt et préserver tout travail existant.
- Ne pas inventer le comportement d'une fonctionnalité.
- Distinguer systématiquement : **CONFIRMÉ**, **À VÉRIFIER**, **HYPOTHÈSE**, **LIMITATION TECHNIQUE**.
- Ne supprimer ni simplifier silencieusement une exigence.
- Ne jamais simuler une intégration en la présentant comme opérationnelle.
- Ne jamais déclarer une commande créée, une synchronisation réussie ou un événement Meta transmis sans confirmation technique.
- Documenter les choix, les compromis, les risques, les coûts et les tests.
- Ne jamais engager de dépense ou d'abonnement sans autorisation du propriétaire.

## 2. Recherche obligatoire avant développement

### 2.1 Audit EasySell

La vidéo EasySell fournie par le propriétaire est la première référence fonctionnelle. Compléter son analyse par des recherches indépendantes et actuelles :

- Fiche Shopify App Store et site officiel EasySell.
- Documentation d'aide, tutoriels et démonstrations.
- Nouveautés et mises à jour récentes.
- Paramètres et fonctionnalités réellement disponibles dans l'interface.
- Différences entre les plans, limites et éventuels coûts additionnels.
- Intégrations tierces et leurs prérequis.
- Avis utilisateurs, problèmes fréquents et demandes récurrentes.

Ne pas se limiter aux arguments marketing. Pour chaque fonction, relever : objectif, parcours administrateur, parcours client, options, données, dépendances, limites, erreurs et coût.

Produire une **matrice de parité EasySell / KB COD Manager** avec les colonnes : fonctionnalité, preuve/source, comportement observé, exigence KB, priorité, dépendances, statut de vérification et tests d'acceptation.

Reproduire les catégories de fonctionnalités et les comportements utiles avec un code et une interface indépendants. Ne pas copier le code source, les éléments graphiques propriétaires, la marque ou les expressions protégées d'EasySell.

### 2.2 Documentation officielle

Vérifier les documentations officielles et à jour de Shopify, Meta, Google Sheets, Google OAuth, des fournisseurs SMS/WhatsApp et de chaque technologie envisagée. Les restrictions de plateforme priment sur les hypothèses de conception.

## 3. Contrainte économique non négociable

Le propriétaire accepte sa facture Shopify habituelle, mais **ne veut pas payer d'abonnement d'hébergement ou de backend**. Aucun service payant ne doit être activé sans accord préalable.

Étudier les offres gratuites compatibles avec un usage commercial, leurs conditions, quotas, limites d'exécution, stockage, sauvegardes, mise en veille, disponibilité et risques de dépassement.

Comparer au minimum :
- Cloudflare Workers, D1 et Queues si pertinents.
- Supabase Free.
- Vercel et ses restrictions d'utilisation commerciale.
- Autres solutions gratuites pertinentes.

Ne pas présumer que Supabase ou Vercel sont obligatoires. Ne pas retenir Vercel Hobby pour un usage commercial si ses conditions ne l'autorisent pas. Une offre gratuite n'est pas automatiquement assez fiable pour les commandes en production.

Si aucune solution gratuite ne répond aux exigences de fiabilité, sécurité et usage commercial, présenter clairement les compromis et demander l'accord du propriétaire avant tout coût. Identifier séparément les coûts potentiels des SMS, WhatsApp, Google Maps et autres prestataires.

## 4. Vision produit et périmètre

KB COD Manager est une application Shopify centrée sur les formulaires de commande COD et les fonctionnalités EasySell. Ce n'est pas un CRM, un ERP ou une plateforme logistique généraliste.

Objectifs :
1. Constructeur de formulaires très personnalisable.
2. Commandes Shopify correctement créées et protégées contre les doublons.
3. Synchronisation Google Sheets fiable.
4. Antifraude configurable, notamment limites IP et fenêtre glissante de 72 heures.
5. Meta Pixel et Conversions API fiables, avec déduplication correcte.
6. Fonctionnalités EasySell complémentaires après audit.
7. Gestion de plusieurs boutiques Shopify indépendantes.

Les priorités absolues sont : **formulaire, intégrité des commandes, Google Sheets, sécurité/antifraude, Meta Pixel et CAPI**. Les autres fonctionnalités EasySell confirmées restent dans le périmètre et le backlog.

## 5. Installation, distribution et multi-boutiques

L'application doit pouvoir être installée sur plusieurs boutiques Shopify indépendantes, y compris des boutiques créées ultérieurement par le propriétaire.

Concevoir dès le départ une architecture compatible avec les exigences de distribution publique Shopify, même si la première utilisation reste privée ou limitée aux boutiques du propriétaire. Vérifier les options de distribution disponibles, les exigences de revue, les éventuels frais et les limites d'une application personnalisée. Ne pas choisir une distribution qui empêcherait l'installation sur des boutiques indépendantes.

Chaque boutique possède des paramètres strictement isolés : formulaires, CSS, règles antifraude, compte Google, tableur, pixels, tokens, intégrations, paramètres et journaux. Utiliser l'identifiant de boutique Shopify comme frontière d'isolation. Tester explicitement l'absence de fuite de données entre boutiques.

Prévoir installation, OAuth, désinstallation, révocation, webhooks et obligations de confidentialité Shopify.

## 6. Constructeur de formulaires — priorité critique

La vidéo EasySell est la référence pour les possibilités de création et de personnalisation. L'audit complémentaire doit identifier les détails qui ne sont pas visibles. Ne pas inventer un constructeur différent ni figer les champs.

### 6.1 Formats

Deux formats obligatoires :
- **Embedded Form** : formulaire intégré à la page produit.
- **Popup Form** : formulaire ouvert dans une fenêtre popup.

Le formulaire doit être responsive, mobile-first et compatible avec les thèmes Shopify usuels. Étudier l'usage d'une Theme App Extension (app block et/ou app embed). Éviter les modifications manuelles du code du thème lorsque l'extension Shopify peut les éviter.

### 6.2 Nombre et affectation

- Un formulaire principal par défaut pour toute la boutique.
- Possibilité facultative de créer plusieurs formulaires indépendants.
- Association d'un formulaire spécifique à un ou plusieurs produits.
- Tout produit sans formulaire spécifique utilise le formulaire principal.
- Duplication, activation, désactivation, modification et suppression contrôlée.

### 6.3 Bibliothèque d'éléments

Reproduire les éléments et options observés dans EasySell et compléter la liste après audit. La vidéo montre notamment des catégories telles que : texte d'introduction, compte à rebours, contenu du panier, offres/bundles, résumé de commande, champs client (prénom, téléphone, adresse, ville, etc.), options de livraison, note, choix multiples, acceptation marketing, bouton de commande et ajout de nouveaux champs.

Cette liste est indicative et ne doit pas limiter la bibliothèque si l'audit confirme d'autres éléments.

### 6.4 Liberté de personnalisation

L'administrateur décide librement des éléments utilisés, de leur ordre, de leur visibilité, de leur contenu et de leurs paramètres. Pour chaque champ, reproduire les options EasySell confirmées : ajout/suppression, ordre, affichage, obligatoire/facultatif, libellé, placeholder, message d'erreur, options, valeurs et paramètres propres au type de champ.

Ne pas imposer de listes de communes, de structure d'adresse ou de parcours de saisie. Un champ Adresse peut rester une saisie libre, selon le choix du marchand. Les champs conditionnels sont acceptés comme capacité facultative et configurable, sans complexifier par défaut le parcours client.

### 6.5 Design

Reproduire les possibilités visuelles observées dans EasySell : modèles, couleurs, arrière-plan, typographie, taille, gras/italique, bordures, épaisseur, arrondis, ombres, espacements, direction RTL/LTR, apparence des champs et boutons, messages et options de bouton flottant (Sticky Button) lorsqu'elles sont confirmées.

Prévoir aperçu en direct, mobile et ordinateur, restauration des valeurs par défaut et duplication de design.

### 6.6 CSS personnalisé

Un éditeur CSS personnalisé est obligatoire. Il doit valider la syntaxe, signaler les erreurs, permettre activation/désactivation et conserver les styles par formulaire. Isoler les styles autant que possible du thème. Ne pas permettre l'exécution arbitraire de JavaScript.

### 6.7 Paramètres additionnels

Auditer et prendre en charge les réglages EasySell confirmés : pays, messages, visibilité, autocomplétion, rupture de stock, affichage des offres/upsells, bouton, frais et autres paramètres observés. Ne pas présenter comme observé ce qui ne l'a pas été.

## 7. Produits, prix et création des commandes Shopify

Récupérer les produits, variantes, prix, images, quantités et disponibilité via les API Shopify autorisées. Valider côté serveur les identifiants, variantes, prix, quantités, stocks et montants ; ne jamais faire confiance aux valeurs du navigateur.

Gérer commandes multi-produits, quantités, offres, bundles, réductions, frais et livraison selon les fonctions validées.

Avant de coder la création des commandes, comparer les méthodes Shopify officiellement supportées (Admin GraphQL API, commandes, brouillons et autres mécanismes applicables). Choisir et documenter une méthode conforme aux règles Shopify et adaptée au COD. Le statut financier ne doit jamais indiquer « payé » si le client n'a pas réellement payé.

Prévenir les doubles clics, doubles soumissions, retries et webhooks répétés avec une stratégie d'idempotence. La commande Shopify est la référence pour les produits et commandes.

## 8. Google Sheets — priorité critique

Chaque boutique peut connecter son propre compte Google et choisir son fichier et son onglet.

Fonctions :
- OAuth Google et autorisation explicite.
- Sélection/changement de compte, spreadsheet et worksheet.
- Reconnexion et révocation.
- Mapping personnalisable entre champs KB et colonnes déjà existantes.
- Données possibles : date, ID commande Shopify, nom, téléphone, email, adresse, ville, produits, variantes, quantités, prix, livraison, réduction, total, note et statut.
- Respect du format de tableau choisi après audit : une ligne par commande ou par produit, et position d'insertion si supportée.
- Ne jamais écraser les données existantes par erreur.

**Règle d'intégrité : enregistrer d'abord la commande dans Shopify, puis synchroniser Sheets.** L'échec Google ne doit jamais supprimer ni annuler une commande.

Créer une file persistante, identifiants idempotents, retries avec délai progressif, statut de synchronisation, journal d'erreur, relance manuelle, reprise après panne et détection des tokens expirés. Statuts : en attente, en cours, synchronisé, échec temporaire, intervention requise.

Tester : plusieurs produits, onglet/fichier renommé ou supprimé, colonne manquante, token expiré, quota API, panne réseau, retries et événements dupliqués.

## 9. Antifraude — priorité critique

Reproduire les protections EasySell confirmées et auditer les options complémentaires.

Prévoir des limites configurables par :
- Numéro de téléphone.
- Adresse IP.
- Identifiant navigateur/client lorsque légal et techniquement pertinent.
- Email si disponible.
- Nombre de commandes par période.
- Quantité maximale par commande.

### Fenêtre glissante 72 heures

La règle doit permettre de définir un maximum de commandes par identifiant sur une durée glissante configurable, notamment 72 heures. Exemple : maximum 2 commandes par numéro sur les 72 dernières heures.

Calculer la période à partir de l'instant de la tentative, pas par remise à zéro à minuit. Configurer le seuil, la durée, l'identifiant et l'action. Prévoir des messages adaptés.

Prévoir listes noires et blanches, motifs, ajout/retrait manuel, historique et autres protections confirmées (robots, soumissions répétées, OTP, tentatives, etc.).

Une IP peut être partagée ou changer : ne pas la traiter comme preuve absolue de fraude. Éviter les faux positifs et limiter la collecte de données personnelles.

## 10. Meta Pixel et Conversions API — priorité critique absolue

Le module doit transmettre des événements cohérents, vérifiables et dédupliqués.

Paramètres par boutique : pixel ID, nom, access token CAPI, activation, tests, plusieurs pixels si supportés et journaux. Les tokens restent côté serveur et sont chiffrés.

Étudier et implémenter les événements standard réellement pertinents : PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo et Purchase. Ne déclencher aucun événement sans action réelle correspondante.

CAPI : envoyer les champs requis et disponibles (event_name, event_time, event_id, action_source, event_source_url, user_data, custom_data, currency, value, content_ids, contents, etc.). Normaliser et hasher les données personnelles conformément aux règles Meta. Ne jamais inventer de données manquantes.

### Déduplication

Pour le même événement envoyé par navigateur et serveur :
- même event_name ;
- même event_id ;
- identifiant stable entre les deux canaux et lors des retries ;
- journal de transmission ;
- aucune nouvelle identité d'événement à chaque tentative.

Documenter le parcours COD : commande soumise, confirmée, expédiée, livrée. Définir explicitement la sémantique de Purchase et les éventuels événements personnalisés de confirmation/livraison. Ne pas confondre commande soumise et commande payée.

Prévoir états, erreurs, retries, réponses API, tests Meta et diagnostic. Auditer les autres pixels présents dans EasySell (TikTok, Google, Snapchat, Pinterest, Taboola, ShareChat, Kwai et autres) et établir leur priorité, faisabilité et coût avant développement.

## 11. SMS, WhatsApp et OTP

Reproduire les fonctions EasySell confirmées : vérification OTP, confirmation, notification d'expédition, récupération de commande abandonnée et messages personnalisés avec variables dynamiques, aperçu, test, limites de tentatives et paramètres par boutique/pays.

Concevoir une architecture fournisseur interchangeable. La fonction doit être désactivable. Identifier les coûts réels des SMS et WhatsApp ; ne pas présenter les envois comme gratuits s'ils ne le sont pas.

## 12. Upsells, bundles et offres

Auditer puis prendre en charge les fonctions EasySell confirmées, notamment :
- Quantity offers.
- Bundles.
- 1-Tick Upsells.
- 1-Click Upsells.
- Cross-sell.
- Downsells.
- Offres pré/post-commande selon le comportement réel.

Documenter déclencheurs, règles de prix, affichage, acceptation/refus, compatibilité Shopify et tests. Ne pas inventer un parcours non observé.

## 13. Commandes abandonnées

Auditer le comportement réel EasySell. Étudier la détection des formulaires commencés non terminés, délai d'abandon (la vidéo évoque 15 minutes : vérifier s'il est configurable), données conservées, liens de récupération, SMS/WhatsApp et intégrations tierces. Respecter le consentement et les règles applicables aux communications marketing.

## 14. Frais, livraison et adresse

Reproduire les règles EasySell confirmées pour frais personnalisés, livraison, taxes si pertinentes, réductions, disponibilité, pays et affichage.

Étudier les règles selon pays, zone, produit, montant, quantité et mode de livraison. Ne pas imposer de listes d'adresses : le marchand choisit comment collecter les informations.

Étudier Google Address Autocomplete comme option facultative. Vérifier la couverture Côte d'Ivoire et les coûts Google Maps. Toujours permettre la saisie libre si l'autocomplétion ne convient pas.

## 15. Analytics, sauvegarde et restauration

Auditer les statistiques EasySell disponibles. Prévoir les indicateurs réellement mesurables : affichages, interactions, commandes, conversion, offres/upsells, abandons, blocages et performance tracking. Documenter les formules.

Prévoir export/import des configurations, sauvegarde des formulaires, règles, paramètres et restauration contrôlée. Ne jamais inclure les secrets en clair dans les exports. Définir les règles de conservation et d'export des données de commande.

## 16. Interface administrateur

Interface claire, moderne et mobile-first. Sections à confirmer après audit : Dashboard, Formulaires, Offres/Upsells, Google Sheets, Pixels/Tracking, Antifraude, SMS/WhatsApp, Abandons, Analytics et Paramètres.

Afficher clairement les connexions expirées, erreurs Sheets, événements Meta en échec et actions requises. Ne pas transformer l'application en CRM généraliste.

## 17. Architecture et sécurité

Utiliser les outils Shopify officiellement recommandés à la date de développement : Shopify CLI, template React Router si adapté, Admin GraphQL API, Theme App Extensions, OAuth et webhooks.

Choisir l'hébergement et la base de données après l'étude de coûts. Les traitements critiques doivent utiliser une file durable ou un mécanisme équivalent, avec idempotence, retries, délai progressif, dead-letter ou suivi des échecs et reprise après interruption. Ne pas dépendre uniquement de fonctions éphémères.

Sécurité :
- secrets côté serveur uniquement ;
- chiffrement des tokens ;
- vérification cryptographique des webhooks ;
- validation stricte des entrées ;
- contrôle des autorisations ;
- isolation multi-boutiques ;
- protection CSRF selon le contexte ;
- limitation de débit ;
- logs sans données personnelles inutiles ;
- sauvegardes et restauration documentées.

Confidentialité : collecte minimale, accès limité, consentement marketing, conservation et suppression, webhooks de confidentialité Shopify, traitement des demandes de suppression et conformité aux règles applicables. Ne pas réutiliser les données clients à d'autres fins.

## 18. Paiements

Décision : COD prioritaire au lancement, aucune intégration obligatoire de paiement en ligne. Préparer une architecture extensible permettant d'étudier les commandes prépayées et prestataires de paiement ultérieurement, sans reconstruire le moteur de commandes.

## 19. Tests et critères d'acceptation

Aucune fonction critique n'est terminée sans tests automatisés et validation sur une boutique de test.

### Formulaire
Embedded, Popup, mobile/desktop, thèmes, champs, ordre, visibilité, CSS, produits/variantes, quantités, calculs, messages et confirmation.

### Commandes
Commande simple et multiple, variantes, frais, réductions, stock, doubles clics, retries, erreurs Shopify, prix et statut financier.

### Antifraude
Limites téléphone/IP/navigateur, fenêtre glissante 72 h, listes, OTP, faux positifs et contournements.

### Sheets
OAuth, mapping, ligne commande/produit, pannes, tokens expirés, retries, doublons et récupération.

### Meta
Pixel, CAPI, event_id commun, déduplication, valeur/devise/produits, données client, erreurs, retries et événements COD.

### Multi-boutiques
Installation de deux boutiques, paramètres distincts, comptes Google et pixels distincts, tests d'isolation.

## 20. Phasage

- **Phase 0 — Recherche et architecture :** audit dépôt, audit EasySell, recherches officielles, matrice de parité, coûts, architecture, modèle de données, risques et plan.
- **Phase 1 — Fondations :** projet Shopify, installation, OAuth, multi-boutiques, base, sécurité, webhooks.
- **Phase 2 — Form Builder :** Embedded, Popup, éléments, champs, design, CSS, aperçu et extension de thème.
- **Phase 3 — Commandes :** produits, variantes, quantités, prix, frais, création Shopify et idempotence.
- **Phase 4 — Antifraude :** limites, IP, téléphone, navigateur, listes, OTP et fenêtre 72 h.
- **Phase 5 — Google Sheets :** OAuth, sélection, mapping, file, retries et historique.
- **Phase 6 — Meta :** Pixel, CAPI, événements, déduplication et diagnostics.
- **Phase 7 — Parité EasySell complémentaire :** upsells, bundles, downsells, SMS, WhatsApp, abandons, autocomplete, analytics, sauvegarde et intégrations confirmées.
- **Phase 8 — Qualité et distribution :** tests, sécurité, tests multi-boutiques, documentation et préparation Shopify.

Le phasage organise le développement ; il ne supprime pas les fonctionnalités du périmètre final.

## 21. Livrables exigés à chaque phase

- Code fonctionnel et tests.
- Migrations et modèle de données.
- Documentation technique et utilisateur.
- Rapport des fonctionnalités réellement terminées.
- Liste des fonctions restantes et limites connues.
- État des coûts et quotas.
- Résultats des tests.
- Risques et décisions à valider.

Livrables finaux : application installable, extension de thème, constructeur, moteur de commandes, antifraude, Google Sheets, Pixel/CAPI, fonctions EasySell complémentaires, isolation multi-boutiques, tests, guide d'installation, configuration, sauvegarde/restauration, coûts et procédure de déploiement/désinstallation.

## 22. Conditions de livraison

Le projet n'est pas terminé parce que l'interface s'affiche ou que le code compile. Il doit être démontré qu'il est possible de :
1. Installer l'application sur une boutique Shopify.
2. Créer un formulaire Embedded et Popup personnalisable.
3. Créer une vraie commande Shopify COD.
4. Appliquer les règles antifraude.
5. Synchroniser la commande vers Google Sheets.
6. Reprendre une synchronisation échouée sans perte ni doublon.
7. Transmettre les événements Meta et vérifier la déduplication.
8. Installer une seconde boutique sans mélange de données.
9. Retrouver les configurations après reconnexion.
10. Diagnostiquer les erreurs.
11. Fonctionner sans service payant non autorisé.

## 23. Première réponse attendue de Claude Code

Avant de coder, examiner le dépôt puis fournir :
- État du dépôt et inventaire des fichiers.
- Rapport d'audit EasySell avec sources.
- Matrice de parité fonctionnelle.
- Étude des hébergements gratuits et coûts réels.
- Architecture recommandée et alternatives.
- Modèle de données et isolation multi-boutiques.
- Analyse des limites Shopify pour formulaire et création COD.
- Stratégie de fiabilité Sheets et Meta.
- Risques, dépendances et plan de tests.
- Backlog de développement par phase.

Signaler toute contradiction ou fonction impossible/limitée par Shopify. Proposer une adaptation, expliquer son impact et demander validation avant une décision qui modifie le périmètre ou engage des coûts.

**Priorités non négociables : fiabilité du formulaire, intégrité des commandes, sauvegarde Google Sheets, sécurité antifraude et exactitude du tracking Meta.**