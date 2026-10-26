# Déploiement de BreachRadar sur le VPS (breachradar.fr)

Même architecture que Waselni : **Docker Compose derrière Traefik**. Traefik (déjà en place sur le
VPS, réseau Docker externe `web`, entrée `websecure`, résolveur `letsencrypt`) obtient le
certificat HTTPS et route le domaine vers les conteneurs :

| Conteneur | Rôle | Exposé |
|---|---|---|
| `breachradar-frontend` | React compilé, servi par Nginx | `breachradar.fr` (www → 301) |
| `breachradar-backend` | API FastAPI (port 8001) | `breachradar.fr/api` |
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
nano .env              # MONGO_ROOT_PASSWORD=$(openssl rand -hex 24), ANTHROPIC_API_KEY=...
chmod 600 .env
./deploy.sh
```

Le dépôt étant privé, `git clone` demande un identifiant GitHub (jeton d'accès) ou une clé
SSH de déploiement, comme pour Waselni.

## 3. Mises à jour

```bash
cd /var/www/breachradar && ./deploy.sh
```

Le script récupère `main`, reconstruit les images, relance les conteneurs et vérifie que
l'API répond. `BRANCH=autre-branche ./deploy.sh` pour déployer une autre branche.

## Commandes utiles

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
