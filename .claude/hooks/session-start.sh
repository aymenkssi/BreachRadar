#!/bin/bash
# SessionStart : synchronise le dépôt avec GitHub puis installe les dépendances
# (Backend Python + Frontend React) pour les sessions Claude Code dans le cloud.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# 1. Pull automatique des dernières modifications de la branche courante.
#    Fast-forward uniquement : on ne touche jamais à un travail local non commité.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    if [ -z "$(git status --porcelain)" ]; then
      git pull --ff-only origin "$branch" || echo "[session-start] pull impossible (historique divergent ?) — à traiter à la main" >&2
    else
      echo "[session-start] modifications locales présentes : pull ignoré" >&2
    fi
  fi
  # Récupère aussi la branche par défaut pour pouvoir comparer/merger.
  git fetch --quiet origin || true
fi

# 2. Backend : dépendances Python.
if [ -f Backend/requirements.txt ]; then
  pip install --quiet --disable-pip-version-check -r Backend/requirements-dev.txt
fi

# 3. Frontend : dépendances Node (yarn).
if [ -f Frontend/package.json ]; then
  (cd Frontend && yarn install --non-interactive --silent)
fi
