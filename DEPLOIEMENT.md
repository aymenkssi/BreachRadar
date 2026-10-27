# Déploiement de BreachRadar sur le VPS (breachradar.fr)

Même architecture que Waselni : **Docker Compose derrière Traefik**. Traefik (déjà en place sur le
VPS, réseau Docker externe `web`, entrée `websecure`, résolveur `letsencrypt`) obtient le
certificat HTTPS et route le domaine vers les conteneurs :

| Conteneur | Rôle | Exposé |
|---|---|---|
| `breachradar-frontend` | React compilé, servi par Nginx | `breachradar.fr` (www → 301) |
| `breachradar-backend` | API FastAPI (port 8001) | `breachradar.fr/api` |
| `breachradar-scheduler` | Veille quotidienne des adresses + relecture des abonnements | non exposé |
| `breachradar-mongodb` | MongoDB 7, volume `mongo_data` | réseau interne uniquement |

## 1. DNS (une seule fois)

Chez le registrar de `breachradar.fr`, créer deux enregistrements **A** vers l'IP du VPS :
`breachradar.fr` et `www.breachradar.fr`. Attendre la propagation
(`dig +short breachradar.fr` doit renvoyer l'IP) avant le premier lancement, sinon
Let's Encrypt ne pourra pas délivrer le certificat.

## 2. Installation (une seule fois)

```bash
cd /opt/apps           # même emplacement que les autres applications
git clone https://github.com/aymenkssi/BreachRadar.git breachradar
cd breachradar
cp .env.example .env
nano .env              # voir .env.example : MONGO_ROOT_PASSWORD, JWT_SECRET, clé IA, Brevo, PayPal
chmod 600 .env
./deploy.sh
```

Le dépôt étant privé, `git clone` demande un identifiant GitHub (jeton d'accès) ou une clé
SSH de déploiement, comme pour Waselni.

## 3. Administration, paiement, e-mails et pages légales

### Mise à jour d'une installation existante

Ajouter dans `.env` (le déploiement s'arrête avec un message clair s'il en manque une) :

```bash
JWT_SECRET=...                 # openssl rand -hex 32 (déjà présent si Premium était installé)
ADMIN_EMAILS=vous@exemple.fr   # adresse(s) des administrateurs, séparées par des virgules
```

Puis `./deploy.sh` et créer le compte administrateur directement sur le serveur, sans code
par e-mail (utile tant que l'envoi d'e-mails n'est pas configuré) :

```bash
docker compose exec backend python create_admin.py admin@breachradar.fr
```

Le mot de passe est demandé deux fois. La même commande réinitialise le mot de passe d'un compte
existant. Se connecter ensuite sur le site, puis **Mon compte → Administration**
(ou https://breachradar.fr/admin).

### Onglets de l'administration

| Onglet | Rôle |
|---|---|
| Vue d'ensemble | comptes, Premium actifs (Stripe / PayPal / offerts), abonnements, quota e-mails du jour |
| Abonnés | recherche, offrir ou retirer Premium, résilier un abonnement, relire son statut chez le fournisseur, supprimer un compte |
| Paiement | activer Stripe et/ou PayPal, clés (chiffrées), création automatique des formules, URL des webhooks, prix affichés |
| Codes promo | créer des codes (réduction en % ou en €, accès offert sans paiement), limiter par formule, nombre d'utilisations et date, activer/désactiver, voir qui les a utilisés |
| E-mails | serveur SMTP principal (Brevo), limite journalière, compteur d'envois sur 14 jours, e-mail de test |
| Infos légales | éditeur, SIRET, hébergeur, médiateur… repris dans les pages légales |
| Journal | actions des administrateurs (sans aucun secret) |

### E-mails (Brevo), comme Waselni

1. Brevo → **Senders, Domains** : authentifier `breachradar.fr` (SPF, DKIM, DMARC).
2. Brevo → **SMTP & API** → **SMTP** : identifiant et clé SMTP.
3. Admin → **E-mails** : serveur `smtp-relay.brevo.com`, port 587, STARTTLS, identifiant, clé,
   expéditeur `alertes@breachradar.fr`, limite 300/jour (offre gratuite). Envoyer un e-mail de test.

Les envois sont comptés par jour (UTC). Au-delà de la limite, ou si Brevo refuse un envoi
(quota signalé par le fournisseur), les e-mails partent par les variables `SMTP_*` du `.env`
si elles désignent un autre service (secours) ; sinon ils ne partent plus jusqu'au lendemain.

### Stripe (carte bancaire)

1. https://dashboard.stripe.com → **Développeurs → Clés API** : clé secrète (`sk_test_…` pour
   les essais, `sk_live_…` en production).
2. Admin → **Paiement** → Stripe : cocher, coller la clé, **Enregistrer**, puis **Créer les
   formules** (crée le produit et les tarifs mensuel et annuel).
3. Stripe → **Développeurs → Webhooks** → *Ajouter un endpoint* : l'URL affichée dans l'admin
   (`https://breachradar.fr/api/billing/stripe/webhook`), événements
   `customer.subscription.created`, `.updated`, `.deleted`, `invoice.paid`,
   `invoice.payment_failed`. Copier le **secret de signature** (`whsec_…`) dans l'admin.
4. Stripe → **Paramètres → Facturation** : activer l'envoi des reçus par e-mail.

### PayPal

1. https://developer.paypal.com → **Apps & Credentials** : application REST (mode *Sandbox*
   pour les essais, *Live* en production), Client ID et Secret.
2. Admin → **Paiement** → PayPal : cocher, mode, Client ID, Secret, **Enregistrer**, puis
   **Créer les formules**.
3. Application PayPal → **Webhooks** : l'URL affichée dans l'admin, événements
   `BILLING.SUBSCRIPTION.*` et `PAYMENT.SALE.COMPLETED`. Recopier l'ID du webhook dans l'admin.

Les deux moyens peuvent être proposés ensemble. Tant qu'aucun n'est complet, l'offre affiche
« bientôt disponible ». Faire un premier essai complet en mode test (Stripe `sk_test_…` avec la
carte 4242 4242 4242 4242, ou PayPal Sandbox) avant de passer en production.

### Codes promo

Le client saisit le code dans **Mon compte → Abonnement**, avant de payer ; le prix réduit
s'affiche avant le paiement. Un compte ne peut utiliser un code qu'une fois.

- **Réduction en % ou en €** sur la première échéance, pendant N mois ou sur toute la durée,
  jusqu'à 100 % (premier mois offert) :
  - Stripe : coupon créé automatiquement à la première utilisation ;
  - PayPal (pas de coupons d'abonnement) : plan PayPal dédié au code, créé automatiquement à la
    première utilisation puis réutilisé, avec une **période d'essai** au prix réduit (gratuite à
    100 %) suivie du tarif normal. Ces plans « BreachRadar Premium … - code XXX » apparaissent dans
    le tableau de bord PayPal. Seule limite : une réduction sur toute la durée doit laisser au
    moins 0,50 € avec PayPal.
  - Formule annuelle : une réduction « pendant N mois » s'applique à la première année.
- **Essai gratuit** : N jours offerts (1 à 365). Le client choisit sa formule et enregistre son moyen
  de paiement (carte via Stripe ou PayPal) ; rien n'est prélevé pendant l'essai, il peut résilier sans
  frais depuis « Mon compte », sinon l'abonnement démarre automatiquement à la fin de l'essai.
  Stripe : `trial_period_days` ; PayPal : plan dédié avec période d'essai gratuite. Conseil : activer
  dans Stripe l'e-mail de rappel avant la fin d'un essai (Paramètres → Facturation → Abonnements).
- Pour offrir Premium **sans** moyen de paiement (partenaire, test) : Administration → Abonnés → Offrir.

### Pages légales (RGPD)

`/mentions-legales`, `/cgv` et `/confidentialite` (liens en bas de page) sont rédigées ; les
informations de l'éditeur se saisissent dans **Infos légales**. Tant qu'il en manque, la page
affiche « [à compléter : …] » en orange. Obligatoire avant d'encaisser : identité et SIRET,
adresse, e-mail de contact, hébergeur, directeur de la publication et **médiateur de la
consommation** (adhésion à un médiateur agréé, liste sur economie.gouv.fr). Ces textes sont une
base solide mais ne remplacent pas la relecture d'un juriste.

Ce qui est en place côté RGPD : acceptation des CGV à l'inscription (date et version
conservées), case de démarrage immédiat avant paiement (droit de rétractation, art. L221-25),
résiliation en ligne, rappel avant reconduction de la formule annuelle (art. L215-1), export et
suppression du compte par l'utilisateur, purge automatique quotidienne (recherches anonymes
après 6 mois, comptes non confirmés après 7 jours, comptes gratuits inactifs après 3 ans),
rotation des journaux Docker, aucun cookie ni traceur publicitaire.

### Fonctionnement de la veille

- Une adresse n'est surveillée qu'après preuve de contrôle : l'adresse du compte (confirmée à
  l'inscription) ou un code envoyé à l'adresse ajoutée. Même règle pour le rapport des mots de passe.
- Le conteneur `breachradar-scheduler` vérifie les adresses toutes les 24 h, envoie les alertes à
  l'adresse du compte, relit les abonnements, envoie les rappels de reconduction et purge les
  données expirées.

## 4. Mises à jour

```bash
cd /opt/apps/breachradar && ./deploy.sh
```

Le script récupère `main`, reconstruit les images, relance les conteneurs et vérifie que
l'API répond. `BRANCH=autre-branche ./deploy.sh` pour déployer une autre branche.

## Déplacer l'installation (ex. /var/www → /opt/apps)

La base MongoDB est un volume Docker (`breachradar_mongo_data`), indépendant du dossier : il suffit
de déplacer le dossier, qui contient aussi le `.env`.

```bash
cd /var/www/breachradar
docker compose exec -T mongodb sh -c 'mongodump --archive -u breachradar_admin -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db breachradar' > ~/breachradar-avant-migration.archive
docker compose down                 # surtout pas « down -v » : cela supprimerait la base
sudo mkdir -p /opt/apps
sudo mv /var/www/breachradar /opt/apps/breachradar
cd /opt/apps/breachradar
./deploy.sh
```

## Sécurité en place

- HTTPS (Traefik), HSTS, Content-Security-Policy stricte (scripts du site et de PayPal uniquement),
  X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy ; réponses de l'API jamais mises en cache.
- Limitation du nombre de requêtes par IP et par compte (recherches, rapports IA, inscription,
  connexion, codes e-mail, codes promo, paiement) : réponse 429 au-delà. Traefik transmet l'IP
  réelle ; un en-tête X-Forwarded-For falsifié par le visiteur est ignoré.
- Mots de passe : bcrypt ; verrouillage après 10 échecs ; un changement de mot de passe ferme les
  sessions ouvertes. `JWT_SECRET` doit faire au moins 32 caractères (`openssl rand -hex 32`).
- Secrets de l'admin chiffrés en base ; MongoDB non exposée ; documentation interactive de l'API désactivée.
- Polices hébergées sur le site (aucun appel à Google Fonts) ; vérification de mot de passe faite
  dans le navigateur (k-anonymat).

## Commandes utiles

```bash
docker compose logs -f scheduler      # passes de veille et alertes envoyées
```


```bash
docker compose ps                     # état des conteneurs
docker compose logs -f backend        # journaux de l'API
docker compose restart backend        # après modification de .env

# Sauvegarde / restauration de la base
docker exec breachradar-mongodb sh -c 'mongodump --archive -u breachradar_admin -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db breachradar' > breachradar-$(date +%F).archive
docker exec -i breachradar-mongodb sh -c 'mongorestore --archive -u breachradar_admin -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --drop' < breachradar-AAAA-MM-JJ.archive
```

Attention : `MONGO_ROOT_PASSWORD` n'est lu qu'à la création du volume. Pour le changer
ensuite, il faut le modifier dans MongoDB puis dans `.env`.
