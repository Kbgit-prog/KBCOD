# Guide de configuration

| Page | À régler |
|---|---|
| **Tableau de bord** | Activation de l'App embed, alertes (Sheets, Meta, commandes incertaines), statistiques 30 jours |
| **Formulaires** | Formulaire principal (toute la boutique) ; *Nouveau formulaire* puis onglet **Produits** pour l'associer à des produits |
| Constructeur > **Éléments** | Glisser ⋮⋮ pour réordonner ; 👁 masquer ; ⧉ dupliquer ; ✕ supprimer. Clic = réglages : libellé, placeholder, obligatoire, clé (Sheets), largeur, message d'erreur, options, longueur, pays du téléphone, condition d'affichage |
| Constructeur > **Design** | Modèle, direction RTL, police, couleurs, bordures, arrondis, ombres, espacements, champs, bouton, animation, voile popup |
| Constructeur > **Paramètres** | Popup ou Embedded, bouton fixe, masquage des boutons du thème, sélecteur CSS déclencheur, pays, rupture de stock, redirection |
| Constructeur > **Messages / CSS / Versions** | Textes affichés, CSS isolé et validé, restauration d'une version |
| **Offres & Upsells** | Offres de quantité (paliers), upsell 1-Tick, downsell à la fermeture, upsell 1-Click après commande. Placez les blocs « Offres de quantité » et « Upsells 1-Tick » dans le formulaire |
| **Livraison & réductions** | Tarifs (pays, seuils, gratuité), codes promo, étiquettes, e-mail Shopify, transaction COD en attente, gestion du stock, étiquette de confirmation |
| **Google Sheets** | Connecter Google → lien du fichier → onglet → colonnes (en-tête ↔ donnée) → *Écrire les en-têtes* si la ligne 1 est vide → activer. *Relancer les échecs* après correction |
| **Pixels & Tracking** | Pixel Meta + jeton CAPI + code test, événements par étape COD, journal |
| **Antifraude** | Limites (identifiant, nombre, fenêtre en heures, action), quantité max, anti-robot, Turnstile, OTP, listes noire/blanche, historique |
| **SMS / WhatsApp** | Fournisseur (Twilio, webhook, WhatsApp Cloud API), jetons (chiffrés), modèles, test, journal. Envois facturés par le fournisseur |
| **Abandons** | Activation, délai (15 min par défaut), conservation, liste et suivi |
| **Paramètres** | Export/import de configuration, durée de conservation, file de travaux (relance) |

## Réglages recommandés (Côte d'Ivoire)
- Pays `CI`, téléphone obligatoire (numéros à 10 chiffres acceptés : `07 07 07 07 07`).
- Antifraude : téléphone **2 commandes / 72 h → refuser** ; IP **5 / 24 h → signaler** ; quantité max 20 ; indicatif autorisé `225` si vous ne livrez qu'en CI.
- Étiquette de confirmation `confirmed` : ajoutez-la dans Shopify après l'appel de confirmation → événement Meta « confirmée ».
- Marquer la commande « payée » dans Shopify à l'encaissement → événement « livrée/payée ».
