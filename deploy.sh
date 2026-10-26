#!/bin/bash
# Mise à jour de BreachRadar sur le VPS : à lancer depuis le dossier du projet.
#   ./deploy.sh            -> récupère main, reconstruit et relance les conteneurs
set -euo pipefail

cd "$(dirname "$0")"
BRANCH="${BRANCH:-main}"

if [ ! -f .env ]; then
  echo "Fichier .env manquant : cp .env.example .env puis le remplir." >&2
  exit 1
fi

if ! docker network inspect web >/dev/null 2>&1; then
  echo "Réseau Docker « web » (Traefik) introuvable sur ce serveur." >&2
  exit 1
fi

echo "==> Récupération de la branche $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Construction et redémarrage des conteneurs"
docker compose up -d --build --remove-orphans

echo "==> Nettoyage des anciennes images"
docker image prune -f >/dev/null

echo "==> Vérification de l'API"
for i in $(seq 1 30); do
  if docker exec breachradar-backend python -c \
      "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/')" 2>/dev/null; then
    echo "OK : https://breachradar.fr"
    docker compose ps
    exit 0
  fi
  sleep 2
done
echo "L'API ne répond pas : docker compose logs backend" >&2
exit 1
