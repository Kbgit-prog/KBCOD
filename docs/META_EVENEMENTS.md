# Meta Pixel + Conversions API — événements COD

## Parcours et événements

| Étape COD | Déclencheur réel | Navigateur (fbq) | Serveur (CAPI) | `event_id` | `payment_status` |
|---|---|---|---|---|---|
| Formulaire ouvert | Ouverture popup / premier focus | `InitiateCheckout` | `InitiateCheckout` (immédiat) | `kbcod.<submissionId>.ic` | — |
| Commande soumise | Commande Shopify **créée** (jamais avant) | Événement configuré (défaut `Purchase`) | même nom | `kbcod.<submissionId>.submit` | `pending` |
| Confirmée | Étiquette de confirmation ajoutée (webhook `orders/updated`) | — | `CODOrderConfirmed` | `kbcod.<id>.confirmed` | `pending` |
| Expédiée | Traitement créé (webhook `fulfillments/create`) | — | `CODOrderShipped` | `kbcod.<id>.shipped` | `pending` |
| Livrée / payée | Commande marquée payée (webhook `orders/paid`) | — | `CODOrderDelivered` | `kbcod.<id>.paid` | `paid` |

- Noms modifiables dans l'admin (Pixels & Tracking). Ne configurez pas `Purchase` à la fois à la soumission et au paiement (double comptage).
- **Sémantique de `Purchase`** : Meta le définit comme un tunnel de commande terminé. Ici il signifie « commande COD passée » et porte toujours `payment_method=cash_on_delivery`, `payment_status=pending`. L'encaissement réel est signalé séparément (`CODOrderDelivered`). Alternative : choisir `Lead` ou un événement personnalisé.

## Déduplication
- Même `event_name` + même `event_id` côté navigateur (`fbq('trackSingle', pixel, name, data, {eventID})`) et serveur.
- L'`event_id` est **déterministe** (dérivé du `submissionId`) : identique entre canaux et entre tentatives ; jamais régénéré.
- Table `tracking_events` unique par (pixel, nom, id) : un événement déjà « envoyé » n'est jamais renvoyé.
- `trackSingle` cible uniquement les pixels configurés dans KB (n'affecte pas un autre pixel installé par Shopify).

## Données envoyées (CAPI)
`event_name, event_time, event_id, action_source=website, event_source_url, user_data{em, ph, fn, ln, ct, st, zp, country, external_id (SHA-256 après normalisation), client_ip_address, client_user_agent, fbp, fbc}, custom_data{currency, value, content_type, content_ids, contents[{id, quantity, item_price}], num_items, order_id, payment_method, payment_status, cod_stage}`. Aucune donnée inventée : un champ absent n'est pas envoyé. Normalisation : minuscules, sans espaces ni ponctuation, téléphone en chiffres avec indicatif.

## Fiabilité et diagnostic
- Erreurs transitoires (5xx, 429, `is_transient`, codes 1/2/4/17/341) → nouvelle tentative (même `event_id`).
- Erreurs définitives (ex. code 190 jeton invalide) → statut `failed`, travail « abandonné », visible dans le journal.
- Journal : statut, tentatives, `events_received`, `fbtrace_id`, message d'erreur (données personnelles hachées uniquement).

## Vérifier avec les outils Meta
1. Pixels & Tracking > Modifier > renseigner le **code d'événement test** (Gestionnaire d'événements > Tester les événements).
2. Bouton **Tester** : envoie un `PageView` serveur de test.
3. Passer une commande de test : vérifier dans « Tester les événements » que `InitiateCheckout` et `Purchase` apparaissent en **Navigateur** et **Serveur** avec la mention **Dédupliqué**.
4. Vider le code de test en production.

## Autres pixels
TikTok, Snapchat, Pinterest, Google Ads, GA4 : événements navigateur si le script de la plateforme est présent (TikTok : `PlaceAnOrder` avec `event_id`). API serveur de ces plateformes : backlog (non développée).
