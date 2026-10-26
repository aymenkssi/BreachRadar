# BreachRadar AI

Outil d'investigation de fuites de données (e-mails / domaines) basé sur l'API XposedOrNot,
avec rapport généré par IA.

## Structure

- `Backend/` — API FastAPI (`server.py`), MongoDB via Motor, préfixe `/api`
- `Frontend/` — React 19 + CRA/craco, Tailwind, composants shadcn/ui
- `design_guidelines.json` — charte graphique

## Démarrage local

```bash
# Backend
cp Backend/.env.example Backend/.env   # renseigner MONGO_URL, DB_NAME, clé LLM
pip install -r Backend/requirements.txt
uvicorn server:app --app-dir Backend --reload --port 8001

# Frontend
cp Frontend/.env.example Frontend/.env
cd Frontend && yarn install && yarn start
```

## Sessions Claude Code (cloud)

`.claude/hooks/session-start.sh` s'exécute à chaque ouverture de session :
1. `git pull --ff-only` de la branche courante (ignoré s'il y a des modifications locales) ;
2. installation des dépendances Python et Node.

Les paquets privés Emergent (`emergentintegrations`, `@emergentbase/*`) ne sont pas
accessibles depuis le cloud : le script continue sans eux.
