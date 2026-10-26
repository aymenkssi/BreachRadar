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
cd /var/www            # même emplacement que les autres applications
git clone https://github.com/aymenkssi/BreachRadar.git breachradar
cd breachradar
cp .env.example .env
nano .env              # voir .env.example : MONGO_ROOT_PASSWORD, JWT_SECRET, clé IA, Brevo, PayPal
chmod 600 .env
./deploy.sh
```

Le dépôt étant privé, `git clone` demande un identifiant GitHub (jeton d'accès) ou une clé
SSH de déploiement, comme pour Waselni.

## 3. Fonctions Premium (comptes, veille, alertes, abonnement)

Mise à jour d'une installation existante : ajouter au minimum `JWT_SECRET=$(openssl rand -hex 32)`
dans `.env` (le déploiement s'arrête avec un message clair s'il manque).

### E-mails (Brevo, comme Waselni)

Codes de confirmation et alertes de fuite. Dans Brevo : **Senders, Domains** → authentifier
`breachradar.fr` (enregistrements DNS SPF/DKIM/DMARC fournis par Brevo), puis **SMTP & API** →
**SMTP** pour l'identifiant et la clé. Renseigner `SMTP_USER`, `SMTP_PASSWORD` et
`SMTP_FROM=alertes@breachradar.fr`. Sans cette configuration, l'inscription est impossible
(aucun code n'est envoyé ; un avertissement apparaît dans `docker compose logs backend`).

### PayPal

1. Sur https://developer.paypal.com → **Apps & Credentials**, créer une application REST
   (mode *Sandbox* pour les essais, *Live* pour la production) : `PAYPAL_CLIENT_ID`,
   `PAYPAL_SECRET`, et `PAYPAL_MODE=sandbox` ou `live`.
2. Créer les deux formules (une seule fois par mode) puis recopier les lignes affichées dans `.env` :
   ```bash
   docker compose run --rm backend python paypal_setup.py 4.99 49.99
   ```
3. Dans l'application PayPal → **Webhooks** → *Add Webhook* :
   URL `https://breachradar.fr/api/billing/paypal/webhook`, événements
   `BILLING.SUBSCRIPTION.ACTIVATED`, `.UPDATED`, `.CANCELLED`, `.SUSPENDED`, `.EXPIRED`,
   `.PAYMENT.FAILED` et `PAYMENT.SALE.COMPLETED`. Recopier son identifiant dans `PAYPAL_WEBHOOK_ID`.
4. `./deploy.sh`. Tant que PayPal n'est pas configuré, l'offre affiche « bientôt disponible ».

Pour tester avec de faux paiements : mode `sandbox` et un compte acheteur fictif
(**Sandbox accounts** dans le tableau de bord développeur), puis refaire les étapes 1 à 3 en `live`.

### Fonctionnement

- Une adresse n'est surveillée qu'après preuve de contrôle : l'adresse du compte (confirmée à
  l'inscription) ou un code envoyé à l'adresse ajoutée. Même règle pour le rapport des mots de passe.
- Le conteneur `breachradar-scheduler` vérifie les adresses toutes les 24 h et envoie l'alerte à
  l'adresse du compte. Les fuites déjà connues lors de l'ajout ne déclenchent pas d'alerte.
- Après une résiliation, Premium reste actif jusqu'à la fin de la période payée ; un paiement refusé
  coupe l'accès jusqu'à régularisation dans PayPal.

## 4. Mises à jour

```bash
cd /var/www/breachradar && ./deploy.sh
```

Le script récupère `main`, reconstruit les images, relance les conteneurs et vérifie que
l'API répond. `BRANCH=autre-branche ./deploy.sh` pour déployer une autre branche.

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
