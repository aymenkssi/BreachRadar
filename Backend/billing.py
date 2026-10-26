# Abonnement Premium via PayPal (API REST « Subscriptions »).
# Les formules mensuelle et annuelle sont des plans créés côté PayPal (voir paypal_setup.py) ;
# le navigateur affiche le bouton PayPal, puis le backend vérifie l'abonnement auprès de PayPal
# avant d'activer Premium. Le webhook et le planificateur gardent le statut à jour.
import asyncio
import logging
import os
import time
from datetime import timedelta
from typing import Any, Dict, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from accounts import current_user, now, parse_dt, public_user
from server import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])

PAYPAL_MODE = os.environ.get("PAYPAL_MODE", "sandbox")
PAYPAL_BASE = "https://api-m.paypal.com" if PAYPAL_MODE == "live" else "https://api-m.sandbox.paypal.com"
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "")
PAYPAL_SECRET = os.environ.get("PAYPAL_SECRET", "")
PAYPAL_WEBHOOK_ID = os.environ.get("PAYPAL_WEBHOOK_ID", "")

PLANS = {
    "monthly": {"label": "Mensuel", "plan_id": os.environ.get("PAYPAL_PLAN_MONTHLY", ""),
                "price": os.environ.get("PRICE_MONTHLY_LABEL", "4,99 €"), "period": "mois", "days": 31},
    "yearly": {"label": "Annuel", "plan_id": os.environ.get("PAYPAL_PLAN_YEARLY", ""),
               "price": os.environ.get("PRICE_YEARLY_LABEL", "49,99 €"), "period": "an", "days": 366},
}
ACTIVE_STATUSES = {"ACTIVE", "APPROVED"}
GRACE = timedelta(days=1)

_token: Dict[str, Any] = {"value": None, "expires": 0.0}


class SubscriptionActivation(BaseModel):
    subscription_id: str


def enabled() -> bool:
    return bool(PAYPAL_CLIENT_ID and PAYPAL_SECRET and all(p["plan_id"] for p in PLANS.values()))


def plan_key(plan_id: str) -> Optional[str]:
    return next((k for k, p in PLANS.items() if p["plan_id"] and p["plan_id"] == plan_id), None)


def _access_token() -> str:
    if _token["value"] and _token["expires"] > time.time() + 60:
        return _token["value"]
    r = requests.post(f"{PAYPAL_BASE}/v1/oauth2/token", auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
                      data={"grant_type": "client_credentials"}, timeout=20)
    r.raise_for_status()
    data = r.json()
    _token.update(value=data["access_token"], expires=time.time() + int(data.get("expires_in", 300)))
    return _token["value"]


def _paypal_sync(method: str, path: str, json: Optional[dict] = None) -> Optional[dict]:
    r = requests.request(method, f"{PAYPAL_BASE}{path}", json=json, timeout=20,
                         headers={"Authorization": f"Bearer {_access_token()}"})
    r.raise_for_status()
    return r.json() if r.content else None


async def paypal(method: str, path: str, json: Optional[dict] = None) -> Optional[dict]:
    return await asyncio.to_thread(_paypal_sync, method, path, json)


async def fetch_subscription(subscription_id: str) -> dict:
    return await paypal("GET", f"/v1/billing/subscriptions/{subscription_id}")


def premium_until_for(sub: dict, key: str) -> str:
    next_billing = parse_dt((sub.get("billing_info") or {}).get("next_billing_time"))
    end = next_billing or (now() + timedelta(days=PLANS[key]["days"]))
    return (end + GRACE).isoformat()


async def apply_subscription(user: dict, sub: dict) -> dict:
    key = plan_key(sub.get("plan_id", ""))
    status = sub.get("status", "")
    update: Dict[str, Any] = {"subscription": {
        "id": sub["id"], "plan": key, "status": status, "updated_at": now().isoformat(),
    }}
    if key and status in ACTIVE_STATUSES:
        computed = parse_dt(premium_until_for(sub, key))
        current = parse_dt(user.get("premium_until"))
        update["premium_until"] = (max(computed, current) if current else computed).isoformat()
    elif status == "SUSPENDED":
        # Paiement refusé : accès coupé jusqu'à régularisation (PayPal réactive l'abonnement)
        update["premium_until"] = now().isoformat()
    # CANCELLED / EXPIRED : l'accès reste ouvert jusqu'à la fin de la période déjà payée
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return {**user, **update}


async def sync_subscription(sub: dict) -> None:
    user = await db.users.find_one({"subscription.id": sub["id"]}, {"_id": 0})
    if not user and sub.get("custom_id"):
        user = await db.users.find_one({"id": sub["custom_id"]}, {"_id": 0})
    if user:
        await apply_subscription(user, sub)
    else:
        logger.warning(f"Abonnement PayPal {sub['id']} sans compte associé")


async def refresh_subscriptions() -> None:
    """Rattrape un webhook manqué : relit chaque abonnement en cours auprès de PayPal."""
    if not enabled():
        return
    cursor = db.users.find({"subscription.status": {"$in": ["ACTIVE", "APPROVED", "SUSPENDED"]}}, {"_id": 0})
    async for user in cursor:
        try:
            await apply_subscription(user, await fetch_subscription(user["subscription"]["id"]))
        except Exception as e:
            logger.error(f"Relecture de l'abonnement de {user['email']} échouée : {e}")


# ---------- Routes ----------
@router.get("/config")
async def config():
    return {
        "enabled": enabled(),
        "client_id": PAYPAL_CLIENT_ID,
        "currency": "EUR",
        "plans": [{"key": k, "label": p["label"], "price": p["price"], "period": p["period"],
                   "plan_id": p["plan_id"]} for k, p in PLANS.items()],
    }


@router.post("/paypal/subscription")
async def activate(req: SubscriptionActivation, user: dict = Depends(current_user)):
    if not enabled():
        raise HTTPException(status_code=503, detail="Paiement indisponible")
    try:
        sub = await fetch_subscription(req.subscription_id)
    except Exception as e:
        logger.error(f"Lecture de l'abonnement {req.subscription_id} échouée : {e}")
        raise HTTPException(status_code=502, detail="Impossible de vérifier l'abonnement auprès de PayPal.")
    if not plan_key(sub.get("plan_id", "")) or sub.get("custom_id") != user["id"]:
        raise HTTPException(status_code=400, detail="Abonnement non reconnu.")
    if sub.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="L'abonnement n'est pas actif.")
    other = await db.users.find_one({"subscription.id": sub["id"], "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
    if other:
        raise HTTPException(status_code=409, detail="Abonnement déjà rattaché à un autre compte.")
    return public_user(await apply_subscription(user, sub))


@router.post("/cancel")
async def cancel(user: dict = Depends(current_user)):
    sub = user.get("subscription") or {}
    if sub.get("status") not in ACTIVE_STATUSES | {"SUSPENDED"}:
        raise HTTPException(status_code=400, detail="Aucun abonnement en cours.")
    try:
        await paypal("POST", f"/v1/billing/subscriptions/{sub['id']}/cancel",
                     {"reason": "Résiliation demandée depuis BreachRadar"})
    except Exception as e:
        logger.error(f"Résiliation de l'abonnement {sub['id']} échouée : {e}")
        raise HTTPException(status_code=502, detail="Résiliation impossible pour le moment, réessayez.")
    update = {"subscription.status": "CANCELLED", "subscription.updated_at": now().isoformat()}
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return public_user(await db.users.find_one({"id": user["id"]}, {"_id": 0}))


async def _verify_webhook(request: Request, event: dict) -> bool:
    if not PAYPAL_WEBHOOK_ID:
        logger.error("PAYPAL_WEBHOOK_ID non défini : webhook ignoré")
        return False
    h = request.headers
    body = {
        "auth_algo": h.get("paypal-auth-algo"),
        "cert_url": h.get("paypal-cert-url"),
        "transmission_id": h.get("paypal-transmission-id"),
        "transmission_sig": h.get("paypal-transmission-sig"),
        "transmission_time": h.get("paypal-transmission-time"),
        "webhook_id": PAYPAL_WEBHOOK_ID,
        "webhook_event": event,
    }
    try:
        result = await paypal("POST", "/v1/notifications/verify-webhook-signature", body)
    except Exception as e:
        logger.error(f"Vérification du webhook PayPal échouée : {e}")
        return False
    return (result or {}).get("verification_status") == "SUCCESS"


@router.post("/paypal/webhook")
async def webhook(request: Request):
    event = await request.json()
    if not await _verify_webhook(request, event):
        raise HTTPException(status_code=400, detail="Signature invalide")
    event_type = event.get("event_type", "")
    resource = event.get("resource") or {}
    if event_type.startswith("BILLING.SUBSCRIPTION."):
        sub_id = resource.get("id")
    elif event_type.startswith("PAYMENT.SALE."):
        sub_id = resource.get("billing_agreement_id")
    else:
        sub_id = None
    if sub_id:
        # On relit l'abonnement plutôt que de se fier au contenu de l'événement
        await sync_subscription(await fetch_subscription(sub_id))
    return {"ok": True}
