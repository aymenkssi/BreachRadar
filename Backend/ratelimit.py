# Limitation du nombre de requêtes par adresse IP ou par compte (fenêtre fixe, compteurs dans MongoDB
# pour être partagés entre les processus uvicorn). Protège les fonctions coûteuses (rapport IA,
# requêtes XposedOrNot) et celles qui envoient des e-mails (quota Brevo, spam de tiers).
import time
from typing import Callable

from fastapi import HTTPException, Request
from pymongo import ReturnDocument

from security import bearer_user_id
from server import db

ENABLED = True  # désactivé dans les tests qui ne portent pas sur la limitation


def client_ip(request: Request) -> str:
    # uvicorn est lancé avec --proxy-headers : client.host est l'IP réelle transmise par Traefik
    return request.client.host if request.client else "inconnue"


def limit(name: str, max_calls: int, window_seconds: int, per: str = "ip") -> Callable:
    """Dépendance FastAPI : au-delà de max_calls appels par fenêtre, renvoie une erreur 429."""
    async def dependency(request: Request) -> None:
        if not ENABLED:
            return
        who = (bearer_user_id(request) or client_ip(request)) if per == "user" else client_ip(request)
        window = int(time.time() // window_seconds)
        doc = await db.rate_limits.find_one_and_update(
            {"_id": f"{name}:{who}:{window}"},
            {"$inc": {"count": 1},
             "$setOnInsert": {"expires_at": time.time() + window_seconds}},
            upsert=True, return_document=ReturnDocument.AFTER,
        )
        if doc["count"] > max_calls:
            retry = int((window + 1) * window_seconds - time.time()) + 1
            minutes = max(1, round(retry / 60))
            raise HTTPException(status_code=429, headers={"Retry-After": str(retry)},
                                detail=f"Trop de demandes. Réessayez dans {minutes} minute(s).")
    return dependency
