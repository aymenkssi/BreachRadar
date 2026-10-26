# BreachRadar AI

Outil d'investigation de fuites de données (e-mails / domaines) basé sur l'API XposedOrNot,
avec rapport généré par Claude (API Anthropic).

## Structure

- `Backend/` — API FastAPI (`server.py`), MongoDB via Motor, préfixe `/api`
- `Frontend/` — React 19 + CRA/craco, Tailwind, composants shadcn/ui
- `design_guidelines.json` — charte graphique

## Démarrage local

```bash
# Backend
cp Backend/.env.example Backend/.env   # renseigner MONGO_URL, DB_NAME, ANTHROPIC_API_KEY
pip install -r Backend/requirements.txt
uvicorn server:app --app-dir Backend --reload --port 8001

# Frontend
cp Frontend/.env.example Frontend/.env
cd Frontend && yarn install && yarn start
```

## Production

Publié sur https://breachradar.fr via Docker Compose + Traefik : voir [DEPLOIEMENT.md](DEPLOIEMENT.md).
Mise à jour sur le VPS : `./deploy.sh`.

## Sessions Claude Code (cloud)

`.claude/hooks/session-start.sh` s'exécute à chaque ouverture de session :
1. `git pull --ff-only` de la branche courante (ignoré s'il y a des modifications locales) ;
2. installation des dépendances Python et Node.

## Rapport IA

`generate_ai_report` choisit le fournisseur selon les clés présentes :

1. `ANTHROPIC_API_KEY` : Claude (`ANTHROPIC_MODEL`, par défaut `claude-opus-5-5`), sortie
   structurée (schéma `AI_REPORT_SCHEMA`) et repli serveur en cas de refus ;
2. sinon `EMERGENT_LLM_KEY` : clé universelle Emergent via `emergentintegrations`
   (`EMERGENT_PROVIDER` / `EMERGENT_MODEL`, par défaut Gemini comme la version d'origine).
   Ce paquet vient de l'index privé Emergent : le Dockerfile l'installe, il n'est pas dans
   `requirements.txt` (inaccessible depuis les sessions cloud) ;
3. sinon, ou en cas d'erreur, un rapport de repli basé sur les statistiques.

## Tests et lint

```bash
cd Backend && python -m pytest -q && python -m flake8 .
```
