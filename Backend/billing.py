# Abonnement Premium mensuel / annuel par PayPal et/ou Stripe.
# Les moyens de paiement se configurent dans l'admin (platform_settings « payments », secrets chiffrés) ;
# à défaut, les variables PAYPAL_* / STRIPE_* du .env s'appliquent.
#  - PayPal : bouton PayPal (API Subscriptions), abonnement vérifié auprès de PayPal avant activation ;
#  - Stripe : page de paiement Stripe Checkout, abonnement vérifié au retour.
# Les webhooks des deux fournisseurs et la passe quotidienne du planificateur tiennent le statut à jour.
import asyncio
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import requests
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import mailer
import settings_store
from accounts import current_user, now, parse_dt, public_user
from server import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])

SETTINGS_KEY = "payments"
PLAN_KEYS = ("monthly", "yearly")
PLAN_INFO = {
    "monthly": {"label": "Mensuel", "period": "mois", "days": 31, "paypal_unit": "MONTH", "stripe_unit": "month"},
    "yearly": {"label": "Annuel", "period": "an", "days": 366, "paypal_unit": "YEAR", "stripe_unit": "year"},
}
GRACE = timedelta(days=1)
# Statuts normalisés : ACTIVE (payé), CANCELLED (résilié, actif jusqu'à la fin de la période),
# SUSPENDED (paiement refusé), EXPIRED (terminé), PENDING (paiement en cours)
CANCELLABLE = {"ACTIVE", "SUSPENDED"}


@dataclass(frozen=True)
class PaymentConfig:
    price_monthly_label: str
    price_yearly_label: str
    paypal_enabled: bool
    paypal_mode: str
    paypal_client_id: str
    paypal_secret: str
    paypal_webhook_id: str
    paypal_plan_monthly: str
    paypal_plan_yearly: str
    stripe_enabled: bool
    stripe_secret_key: str
    stripe_webhook_secret: str
    stripe_price_monthly: str
    stripe_price_yearly: str

    @property
    def paypal_ready(self) -> bool:
        return bool(self.paypal_enabled and self.paypal_client_id and self.paypal_secret
                    and self.paypal_plan_monthly and self.paypal_plan_yearly)

    @property
    def stripe_ready(self) -> bool:
        return bool(self.stripe_enabled and self.stripe_secret_key
                    and self.stripe_price_monthly and self.stripe_price_yearly)

    @property
    def paypal_base(self) -> str:
        return "https://api-m.paypal.com" if self.paypal_mode == "live" else "https://api-m.sandbox.paypal.com"

    def plan_for(self, provider: str, plan_or_price_id: str) -> Optional[str]:
        ids = {"monthly": getattr(self, f"{provider}_{'plan' if provider == 'paypal' else 'price'}_monthly"),
               "yearly": getattr(self, f"{provider}_{'plan' if provider == 'paypal' else 'price'}_yearly")}
        return next((k for k, v in ids.items() if v and v == plan_or_price_id), None)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


async def get_config() -> PaymentConfig:
    doc = await settings_store.get(SETTINGS_KEY) or {}

    def pick(field: str, env: str, default: str = "") -> str:
        return doc.get(field) or _env(env, default)

    def secret(field: str, env: str) -> str:
        return settings_store.decrypt_secret(doc.get(f"{field}_encrypted")) or _env(env)

    paypal_client = pick("paypal_client_id", "PAYPAL_CLIENT_ID")
    stripe_key = secret("stripe_secret_key", "STRIPE_SECRET_KEY")
    return PaymentConfig(
        price_monthly_label=pick("price_monthly_label", "PRICE_MONTHLY_LABEL", "4,99 €"),
        price_yearly_label=pick("price_yearly_label", "PRICE_YEARLY_LABEL", "49,99 €"),
        paypal_enabled=doc.get("paypal_enabled", bool(paypal_client)),
        paypal_mode=pick("paypal_mode", "PAYPAL_MODE", "sandbox"),
        paypal_client_id=paypal_client,
        paypal_secret=secret("paypal_secret", "PAYPAL_SECRET"),
        paypal_webhook_id=pick("paypal_webhook_id", "PAYPAL_WEBHOOK_ID"),
        paypal_plan_monthly=pick("paypal_plan_monthly", "PAYPAL_PLAN_MONTHLY"),
        paypal_plan_yearly=pick("paypal_plan_yearly", "PAYPAL_PLAN_YEARLY"),
        stripe_enabled=doc.get("stripe_enabled", bool(stripe_key)),
        stripe_secret_key=stripe_key,
        stripe_webhook_secret=secret("stripe_webhook_secret", "STRIPE_WEBHOOK_SECRET"),
        stripe_price_monthly=pick("stripe_price_monthly", "STRIPE_PRICE_MONTHLY"),
        stripe_price_yearly=pick("stripe_price_yearly", "STRIPE_PRICE_YEARLY"),
    )


# ---------- Application d'un abonnement à un compte ----------
async def apply_subscription(user: dict, provider: str, sub_id: str, plan: Optional[str], status: str,
                             period_end: Optional[datetime], customer_id: Optional[str] = None) -> dict:
    update: Dict[str, Any] = {"subscription": {
        "provider": provider, "id": sub_id, "plan": plan, "status": status, "updated_at": now().isoformat(),
    }}
    if customer_id:
        update["stripe_customer_id"] = customer_id
    current = parse_dt(user.get("premium_until"))
    end = None
    if status == "ACTIVE" and plan:
        end = (period_end or now() + timedelta(days=PLAN_INFO[plan]["days"])) + GRACE
    elif status == "CANCELLED" and period_end:
        end = period_end + GRACE  # résilié : accès jusqu'à la fin de la période déjà payée
    if end:
        update["premium_until"] = (max(end, current) if current else end).isoformat()
    elif status == "SUSPENDED":
        update["premium_until"] = now().isoformat()  # paiement refusé : accès coupé jusqu'à régularisation
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return {**user, **update}


async def _user_for(provider: str, sub_id: str, fallback_user_id: Optional[str]) -> Optional[dict]:
    user = await db.users.find_one({"subscription.id": sub_id}, {"_id": 0})
    if not user and fallback_user_id:
        user = await db.users.find_one({"id": fallback_user_id}, {"_id": 0})
    if not user:
        logger.warning(f"Abonnement {provider} {sub_id} sans compte associé")
    return user


# ---------- PayPal ----------
_paypal_tokens: Dict[str, Any] = {}
PAYPAL_STATUS = {"ACTIVE": "ACTIVE", "APPROVED": "ACTIVE", "CANCELLED": "CANCELLED", "SUSPENDED": "SUSPENDED",
                 "EXPIRED": "EXPIRED", "APPROVAL_PENDING": "PENDING"}


def _paypal_token(cfg: PaymentConfig) -> str:
    cached = _paypal_tokens.get(cfg.paypal_client_id)
    if cached and cached["expires"] > time.time() + 60:
        return cached["value"]
    r = requests.post(f"{cfg.paypal_base}/v1/oauth2/token", auth=(cfg.paypal_client_id, cfg.paypal_secret),
                      data={"grant_type": "client_credentials"}, timeout=20)
    r.raise_for_status()
    data = r.json()
    _paypal_tokens[cfg.paypal_client_id] = {"value": data["access_token"],
                                            "expires": time.time() + int(data.get("expires_in", 300))}
    return data["access_token"]


def _paypal_sync(cfg: PaymentConfig, method: str, path: str, json: Optional[dict] = None) -> Optional[dict]:
    r = requests.request(method, f"{cfg.paypal_base}{path}", json=json, timeout=20,
                         headers={"Authorization": f"Bearer {_paypal_token(cfg)}"})
    r.raise_for_status()
    return r.json() if r.content else None


async def paypal(cfg: PaymentConfig, method: str, path: str, json: Optional[dict] = None) -> Optional[dict]:
    return await asyncio.to_thread(_paypal_sync, cfg, method, path, json)


async def apply_paypal(cfg: PaymentConfig, user: dict, sub: dict) -> dict:
    period_end = parse_dt((sub.get("billing_info") or {}).get("next_billing_time"))
    status = PAYPAL_STATUS.get(sub.get("status", ""), "PENDING")
    return await apply_subscription(user, "paypal", sub["id"], cfg.plan_for("paypal", sub.get("plan_id", "")),
                                    status, period_end)


async def sync_paypal(cfg: PaymentConfig, sub_id: str) -> None:
    sub = await paypal(cfg, "GET", f"/v1/billing/subscriptions/{sub_id}")
    user = await _user_for("paypal", sub["id"], sub.get("custom_id"))
    if user:
        await apply_paypal(cfg, user, sub)


def create_paypal_plans(cfg: PaymentConfig, monthly: str, yearly: str) -> Dict[str, str]:
    product = _paypal_sync(cfg, "POST", "/v1/catalogs/products", {
        "name": "BreachRadar Premium", "type": "SERVICE", "category": "SOFTWARE",
        "description": "Veille des fuites de données et rapport des mots de passe",
    })
    ids = {}
    for key, price in (("monthly", monthly), ("yearly", yearly)):
        ids[key] = _paypal_sync(cfg, "POST", "/v1/billing/plans", {
            "product_id": product["id"], "name": f"BreachRadar Premium {PLAN_INFO[key]['label'].lower()}",
            "status": "ACTIVE",
            "billing_cycles": [{
                "frequency": {"interval_unit": PLAN_INFO[key]["paypal_unit"], "interval_count": 1},
                "tenure_type": "REGULAR", "sequence": 1, "total_cycles": 0,
                "pricing_scheme": {"fixed_price": {"value": price, "currency_code": "EUR"}},
            }],
            "payment_preferences": {"auto_bill_outstanding": True, "payment_failure_threshold": 1},
        })["id"]
    return ids


# ---------- Stripe ----------
STRIPE_STATUS = {"active": "ACTIVE", "trialing": "ACTIVE", "past_due": "SUSPENDED", "unpaid": "SUSPENDED",
                 "paused": "SUSPENDED", "canceled": "EXPIRED", "incomplete_expired": "EXPIRED", "incomplete": "PENDING"}


def stripe_period_end(sub: dict) -> Optional[datetime]:
    # Selon la version de l'API Stripe, la fin de période est sur l'abonnement ou sur ses lignes
    ts = sub.get("current_period_end") or max(
        (i.get("current_period_end") or 0 for i in (sub.get("items") or {}).get("data", [])), default=0)
    return datetime.fromtimestamp(ts, timezone.utc) if ts else None


def stripe_price_id(sub: dict) -> str:
    items = (sub.get("items") or {}).get("data") or [{}]
    return (items[0].get("price") or {}).get("id", "")


async def apply_stripe(cfg: PaymentConfig, user: dict, sub: dict) -> dict:
    status = STRIPE_STATUS.get(sub.get("status", ""), "PENDING")
    if status == "ACTIVE" and sub.get("cancel_at_period_end"):
        status = "CANCELLED"
    customer = sub.get("customer")
    customer_id = customer.get("id") if isinstance(customer, dict) else customer
    return await apply_subscription(user, "stripe", sub["id"], cfg.plan_for("stripe", stripe_price_id(sub)),
                                    status, stripe_period_end(sub), customer_id)


async def stripe_call(fn, *args, **kwargs) -> dict:
    obj = await asyncio.to_thread(fn, *args, **kwargs)
    return obj.to_dict() if hasattr(obj, "to_dict") else obj


async def sync_stripe(cfg: PaymentConfig, sub_id: str) -> None:
    sub = await stripe_call(stripe.Subscription.retrieve, sub_id, api_key=cfg.stripe_secret_key)
    user = await _user_for("stripe", sub["id"], (sub.get("metadata") or {}).get("user_id"))
    if user:
        await apply_stripe(cfg, user, sub)


def create_stripe_prices(cfg: PaymentConfig, monthly: str, yearly: str) -> Dict[str, str]:
    key = cfg.stripe_secret_key
    product = stripe.Product.create(name="BreachRadar Premium", api_key=key,
                                    description="Veille des fuites de données et rapport des mots de passe")
    ids = {}
    for plan, price in (("monthly", monthly), ("yearly", yearly)):
        ids[plan] = stripe.Price.create(
            product=product.id, currency="eur", unit_amount=round(float(price) * 100),
            recurring={"interval": PLAN_INFO[plan]["stripe_unit"]}, api_key=key,
        ).id
    return ids


# ---------- Commun ----------
async def sync_user(user: dict) -> None:
    sub = user.get("subscription") or {}
    cfg = await get_config()
    if sub.get("provider") == "stripe":
        await sync_stripe(cfg, sub["id"])
    elif sub.get("id"):
        await sync_paypal(cfg, sub["id"])


async def cancel_user_subscription(user: dict) -> dict:
    sub = user.get("subscription") or {}
    if sub.get("status") not in CANCELLABLE:
        raise HTTPException(status_code=400, detail="Aucun abonnement en cours.")
    cfg = await get_config()
    try:
        if sub.get("provider") == "stripe":
            updated = await stripe_call(stripe.Subscription.modify, sub["id"], cancel_at_period_end=True,
                                        api_key=cfg.stripe_secret_key)
            return await apply_stripe(cfg, user, updated)
        await paypal(cfg, "POST", f"/v1/billing/subscriptions/{sub['id']}/cancel",
                     {"reason": "Résiliation demandée depuis BreachRadar"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Résiliation de l'abonnement {sub['id']} échouée : {e}")
        raise HTTPException(status_code=502, detail="Résiliation impossible pour le moment, réessayez.")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "subscription.status": "CANCELLED", "subscription.updated_at": now().isoformat()}})
    return await db.users.find_one({"id": user["id"]}, {"_id": 0})


async def refresh_subscriptions() -> None:
    """Rattrape un webhook manqué : relit chaque abonnement en cours auprès de son fournisseur."""
    async for user in db.users.find({"subscription.status": {"$in": ["ACTIVE", "SUSPENDED", "PENDING"]}}, {"_id": 0}):
        try:
            await sync_user(user)
        except Exception as e:
            logger.error(f"Relecture de l'abonnement de {user['email']} échouée : {e}")


REMINDER_MIN_DAYS, REMINDER_MAX_DAYS = 30, 60


async def send_renewal_reminders() -> int:
    """Formule annuelle : prévient l'abonné 1 à 2 mois avant la reconduction (art. L215-1 C. conso)."""
    cfg = await get_config()
    sent = 0
    async for user in db.users.find({"subscription.status": "ACTIVE", "subscription.plan": "yearly"}, {"_id": 0}):
        renewal = parse_dt(user.get("premium_until"))
        if not renewal:
            continue
        renewal -= GRACE
        days_left = (renewal - now()).days
        key = renewal.date().isoformat()
        if REMINDER_MIN_DAYS <= days_left <= REMINDER_MAX_DAYS and user.get("renewal_reminder_for") != key:
            date_fr = renewal.strftime("%d/%m/%Y")
            if await mailer.send_renewal_reminder(user["email"], date_fr, cfg.price_yearly_label):
                await db.users.update_one({"id": user["id"]}, {"$set": {"renewal_reminder_for": key}})
                sent += 1
    return sent


# ---------- Routes ----------
class PaypalActivation(BaseModel):
    subscription_id: str


class StripeCheckout(BaseModel):
    plan: str


class StripeConfirm(BaseModel):
    session_id: str


@router.get("/config")
async def config():
    cfg = await get_config()
    return {
        "enabled": cfg.paypal_ready or cfg.stripe_ready,
        "currency": "EUR",
        "plans": [{"key": k, "label": PLAN_INFO[k]["label"], "period": PLAN_INFO[k]["period"],
                   "price": cfg.price_monthly_label if k == "monthly" else cfg.price_yearly_label} for k in PLAN_KEYS],
        "paypal": {"enabled": cfg.paypal_ready, "client_id": cfg.paypal_client_id if cfg.paypal_ready else "",
                   "plans": {"monthly": cfg.paypal_plan_monthly, "yearly": cfg.paypal_plan_yearly}
                   if cfg.paypal_ready else {}},
        "stripe": {"enabled": cfg.stripe_ready},
    }


@router.post("/paypal/subscription")
async def paypal_activate(req: PaypalActivation, user: dict = Depends(current_user)):
    cfg = await get_config()
    if not cfg.paypal_ready:
        raise HTTPException(status_code=503, detail="Paiement PayPal indisponible")
    try:
        sub = await paypal(cfg, "GET", f"/v1/billing/subscriptions/{req.subscription_id}")
    except Exception as e:
        logger.error(f"Lecture de l'abonnement {req.subscription_id} échouée : {e}")
        raise HTTPException(status_code=502, detail="Impossible de vérifier l'abonnement auprès de PayPal.")
    if not cfg.plan_for("paypal", sub.get("plan_id", "")) or sub.get("custom_id") != user["id"]:
        raise HTTPException(status_code=400, detail="Abonnement non reconnu.")
    if PAYPAL_STATUS.get(sub.get("status")) != "ACTIVE":
        raise HTTPException(status_code=400, detail="L'abonnement n'est pas actif.")
    if await db.users.find_one({"subscription.id": sub["id"], "id": {"$ne": user["id"]}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Abonnement déjà rattaché à un autre compte.")
    return public_user(await apply_paypal(cfg, user, sub))


@router.post("/stripe/checkout")
async def stripe_checkout(req: StripeCheckout, user: dict = Depends(current_user)):
    cfg = await get_config()
    if not cfg.stripe_ready or req.plan not in PLAN_KEYS:
        raise HTTPException(status_code=503, detail="Paiement par carte indisponible")
    params: Dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": getattr(cfg, f"stripe_price_{req.plan}"), "quantity": 1}],
        "client_reference_id": user["id"],
        "subscription_data": {"metadata": {"user_id": user["id"]}},
        "success_url": f"{mailer.public_url()}/?premium=stripe&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{mailer.public_url()}/?premium=cancel",
        "locale": "fr",
    }
    if user.get("stripe_customer_id"):
        params["customer"] = user["stripe_customer_id"]
    else:
        params["customer_email"] = user["email"]
    try:
        session = await stripe_call(stripe.checkout.Session.create, api_key=cfg.stripe_secret_key, **params)
    except Exception as e:
        logger.error(f"Création de la session Stripe échouée : {e}")
        raise HTTPException(status_code=502, detail="Paiement par carte momentanément indisponible.")
    return {"url": session["url"]}


@router.post("/stripe/confirm")
async def stripe_confirm(req: StripeConfirm, user: dict = Depends(current_user)):
    cfg = await get_config()
    if not cfg.stripe_ready:
        raise HTTPException(status_code=503, detail="Paiement par carte indisponible")
    try:
        session = await stripe_call(stripe.checkout.Session.retrieve, req.session_id,
                                    expand=["subscription"], api_key=cfg.stripe_secret_key)
    except Exception as e:
        logger.error(f"Lecture de la session Stripe {req.session_id} échouée : {e}")
        raise HTTPException(status_code=502, detail="Impossible de vérifier le paiement auprès de Stripe.")
    sub = session.get("subscription")
    if session.get("client_reference_id") != user["id"] or not isinstance(sub, dict):
        raise HTTPException(status_code=400, detail="Paiement non reconnu.")
    return public_user(await apply_stripe(cfg, user, sub))


@router.post("/cancel")
async def cancel(user: dict = Depends(current_user)):
    return public_user(await cancel_user_subscription(user))


async def _verify_paypal_webhook(cfg: PaymentConfig, request: Request, event: dict) -> bool:
    if not cfg.paypal_webhook_id:
        logger.error("Identifiant du webhook PayPal non configuré : événement ignoré")
        return False
    h = request.headers
    body = {
        "auth_algo": h.get("paypal-auth-algo"), "cert_url": h.get("paypal-cert-url"),
        "transmission_id": h.get("paypal-transmission-id"), "transmission_sig": h.get("paypal-transmission-sig"),
        "transmission_time": h.get("paypal-transmission-time"), "webhook_id": cfg.paypal_webhook_id,
        "webhook_event": event,
    }
    try:
        result = await paypal(cfg, "POST", "/v1/notifications/verify-webhook-signature", body)
    except Exception as e:
        logger.error(f"Vérification du webhook PayPal échouée : {e}")
        return False
    return (result or {}).get("verification_status") == "SUCCESS"


@router.post("/paypal/webhook")
async def paypal_webhook(request: Request):
    cfg = await get_config()
    event = await request.json()
    if not await _verify_paypal_webhook(cfg, request, event):
        raise HTTPException(status_code=400, detail="Signature invalide")
    event_type, resource = event.get("event_type", ""), event.get("resource") or {}
    sub_id = (resource.get("id") if event_type.startswith("BILLING.SUBSCRIPTION.")
              else resource.get("billing_agreement_id") if event_type.startswith("PAYMENT.SALE.") else None)
    if sub_id:
        await sync_paypal(cfg, sub_id)  # on relit l'abonnement plutôt que de se fier à l'événement
    return {"ok": True}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    cfg = await get_config()
    if not cfg.stripe_webhook_secret:
        raise HTTPException(status_code=400, detail="Webhook Stripe non configuré")
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature"),
                                               cfg.stripe_webhook_secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Signature invalide")
    event = event.to_dict() if hasattr(event, "to_dict") else event
    obj = event.get("data", {}).get("object", {})
    event_type = event.get("type", "")
    sub_id = None
    if event_type.startswith("customer.subscription."):
        sub_id = obj.get("id")
    elif event_type.startswith("invoice."):
        sub_id = obj.get("subscription") or (
            ((obj.get("parent") or {}).get("subscription_details") or {}).get("subscription"))
    if sub_id:
        await sync_stripe(cfg, sub_id)
    return {"ok": True}
