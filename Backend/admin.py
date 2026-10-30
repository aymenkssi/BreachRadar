# Administration : abonnés et abonnements, moyens de paiement (PayPal / Stripe), serveur d'e-mails
# avec compteur d'envois (quota), informations légales affichées sur les pages RGPD, journal d'audit.
# Accès réservé aux comptes dont l'adresse figure dans ADMIN_EMAILS.
import asyncio
import re
from datetime import datetime, time, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import billing
import mailer
import settings_store
import stats
from accounts import admin_user, audit, is_premium, now, parse_dt, public_user
from privacy import delete_user_data
from server import ANTHROPIC_API_KEY, EMERGENT_LLM_KEY, db

router = APIRouter(prefix="/api/admin", tags=["admin"])
public_router = APIRouter(prefix="/api", tags=["legal"])

LEGAL_KEY = "legal"
LEGAL_FIELDS = (
    "company_name", "legal_form", "capital", "address", "siret", "rcs", "vat_number", "contact_email", "phone",
    "publication_director", "host_name", "host_address", "host_phone", "mediator_name", "mediator_url",
)
PAGE_SIZE = 50


# ---------- Vue d'ensemble ----------
@router.get("/overview")
async def overview(admin: dict = Depends(admin_user)):
    users = await db.users.find({"email_verified": True}, {"_id": 0, "premium_until": 1, "subscription": 1,
                                                           "manual_premium": 1}).to_list(100000)
    premium = [u for u in users if is_premium(u)]
    by_provider = {"paypal": 0, "stripe": 0, "manuel": 0}
    for u in premium:
        sub = u.get("subscription") or {}
        key = (sub.get("provider") or "paypal") if sub.get("status") in ("ACTIVE", "CANCELLED") else "manuel"
        by_provider[key] = by_provider.get(key, 0) + 1
    by_plan = {"monthly": 0, "yearly": 0}
    for u in premium:
        plan = (u.get("subscription") or {}).get("plan")
        if plan in by_plan and (u.get("subscription") or {}).get("status") == "ACTIVE":
            by_plan[plan] += 1
    return {
        "users": len(users),
        "premium": len(premium),
        "premium_by_provider": by_provider,
        "active_by_plan": by_plan,
        "suspended": sum(1 for u in users if (u.get("subscription") or {}).get("status") == "SUSPENDED"),
        "monitors": await db.monitors.count_documents({"verified": True}),
        "emails": await mailer.usage(),
    }


# ---------- Abonnés ----------
class PremiumGrant(BaseModel):
    until: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str = Field("", max_length=200)


def admin_view(user: dict, monitors: int) -> dict:
    return {**public_user(user), "email_verified": user.get("email_verified", False),
            "created_at": user.get("created_at"), "last_login_at": user.get("last_login_at"),
            "manual_premium": user.get("manual_premium"), "monitors": monitors,
            "subscription_id": (user.get("subscription") or {}).get("id")}


async def _target(user_id: str) -> dict:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return user


async def _view(user_id: str) -> dict:
    user = await _target(user_id)
    return admin_view(user, await db.monitors.count_documents({"user_id": user_id}))


@router.get("/users")
async def list_users(q: str = "", status: Literal["all", "premium", "free", "suspended"] = "all", page: int = 1,
                     admin: dict = Depends(admin_user)):
    query: dict = {}
    if q.strip():
        query["email"] = {"$regex": re.escape(q.strip().lower())}
    if status == "suspended":
        query["subscription.status"] = "SUSPENDED"
    docs = await db.users.find(query, {"_id": 0}).sort("created_at", -1).to_list(100000)
    if status == "premium":
        docs = [u for u in docs if is_premium(u)]
    elif status == "free":
        docs = [u for u in docs if not is_premium(u)]
    page = max(1, page)
    chunk = docs[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    counts = {}
    for u in chunk:
        counts[u["id"]] = await db.monitors.count_documents({"user_id": u["id"]})
    return {"total": len(docs), "page": page, "page_size": PAGE_SIZE,
            "users": [admin_view(u, counts[u["id"]]) for u in chunk]}


@router.post("/users/{user_id}/premium")
async def grant_premium(user_id: str, req: PremiumGrant, admin: dict = Depends(admin_user)):
    user = await _target(user_id)
    until = datetime.combine(datetime.strptime(req.until, "%Y-%m-%d").date(), time(23, 59, 59), timezone.utc)
    if until <= now():
        raise HTTPException(status_code=400, detail="La date doit être dans le futur.")
    current = parse_dt(user.get("premium_until"))
    await db.users.update_one({"id": user_id}, {"$set": {
        "premium_until": max(until, current).isoformat() if current else until.isoformat(),
        "manual_premium": {"until": until.isoformat(), "by": admin["email"], "at": now().isoformat(), "note": req.note},
    }})
    await audit(admin, "PREMIUM_GRANT", f"user={user['email']}; until={req.until}")
    return await _view(user_id)


@router.post("/users/{user_id}/revoke")
async def revoke_premium(user_id: str, admin: dict = Depends(admin_user)):
    user = await _target(user_id)
    await db.users.update_one({"id": user_id}, {"$set": {"premium_until": now().isoformat(), "manual_premium": None}})
    await audit(admin, "PREMIUM_REVOKE", f"user={user['email']}")
    return await _view(user_id)


@router.post("/users/{user_id}/cancel")
async def cancel_subscription(user_id: str, admin: dict = Depends(admin_user)):
    user = await _target(user_id)
    await billing.cancel_user_subscription(user)
    await audit(admin, "SUBSCRIPTION_CANCEL", f"user={user['email']}")
    return await _view(user_id)


@router.post("/users/{user_id}/sync")
async def sync_subscription(user_id: str, admin: dict = Depends(admin_user)):
    user = await _target(user_id)
    if not (user.get("subscription") or {}).get("id"):
        raise HTTPException(status_code=400, detail="Aucun abonnement PayPal ou Stripe.")
    try:
        await billing.sync_user(user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lecture impossible chez le fournisseur : {e}"[:300])
    return await _view(user_id)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(admin_user)):
    user = await _target(user_id)
    if user["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="Supprimez votre propre compte depuis « Mon compte ».")
    await delete_user_data(user)
    await audit(admin, "USER_DELETE", f"user={user['email']}")
    return {"ok": True}


# ---------- Moyens de paiement ----------
ID_PATTERN = r"^[A-Za-z0-9_-]*$"


class PaymentSettingsIn(BaseModel):
    price_monthly_label: str = Field(min_length=1, max_length=30)
    price_yearly_label: str = Field(min_length=1, max_length=30)
    paypal_enabled: bool
    paypal_mode: Literal["sandbox", "live"]
    paypal_client_id: str = Field("", max_length=200, pattern=ID_PATTERN)
    paypal_secret: Optional[str] = Field(None, max_length=300)
    clear_paypal_secret: bool = False
    paypal_webhook_id: str = Field("", max_length=100, pattern=ID_PATTERN)
    paypal_plan_monthly: str = Field("", max_length=100, pattern=ID_PATTERN)
    paypal_plan_yearly: str = Field("", max_length=100, pattern=ID_PATTERN)
    stripe_enabled: bool
    stripe_secret_key: Optional[str] = Field(None, max_length=300)
    clear_stripe_secret_key: bool = False
    stripe_webhook_secret: Optional[str] = Field(None, max_length=300)
    clear_stripe_webhook_secret: bool = False
    stripe_price_monthly: str = Field("", max_length=100, pattern=ID_PATTERN)
    stripe_price_yearly: str = Field("", max_length=100, pattern=ID_PATTERN)


class PlanCreation(BaseModel):
    provider: Literal["paypal", "stripe"]
    monthly: str = Field(pattern=r"^\d{1,4}([.,]\d{1,2})?$")
    yearly: str = Field(pattern=r"^\d{1,4}([.,]\d{1,2})?$")


async def payments_out() -> dict:
    doc = await settings_store.get(billing.SETTINGS_KEY) or {}
    cfg = await billing.get_config()
    base = mailer.public_url()
    return {
        "source": "admin" if doc else "env",
        "price_monthly_label": cfg.price_monthly_label, "price_yearly_label": cfg.price_yearly_label,
        "paypal_enabled": cfg.paypal_enabled, "paypal_mode": cfg.paypal_mode,
        "paypal_client_id": cfg.paypal_client_id, "paypal_secret_set": bool(cfg.paypal_secret),
        "paypal_webhook_id": cfg.paypal_webhook_id, "paypal_plan_monthly": cfg.paypal_plan_monthly,
        "paypal_plan_yearly": cfg.paypal_plan_yearly, "paypal_ready": cfg.paypal_ready,
        "paypal_webhook_url": f"{base}/api/billing/paypal/webhook",
        "stripe_enabled": cfg.stripe_enabled, "stripe_secret_key_set": bool(cfg.stripe_secret_key),
        "stripe_secret_key_mode": ("test" if cfg.stripe_secret_key.startswith(("sk_test", "rk_test")) else "live")
        if cfg.stripe_secret_key else None,
        "stripe_webhook_secret_set": bool(cfg.stripe_webhook_secret),
        "stripe_price_monthly": cfg.stripe_price_monthly, "stripe_price_yearly": cfg.stripe_price_yearly,
        "stripe_ready": cfg.stripe_ready, "stripe_webhook_url": f"{base}/api/billing/stripe/webhook",
        "updated_at": doc.get("updated_at"), "updated_by": doc.get("updated_by"),
    }


@router.get("/payments")
async def get_payments(admin: dict = Depends(admin_user)):
    return await payments_out()


@router.put("/payments")
async def update_payments(req: PaymentSettingsIn, admin: dict = Depends(admin_user)):
    existing = await settings_store.get(billing.SETTINGS_KEY) or {}
    plain = req.model_dump(exclude={"paypal_secret", "clear_paypal_secret", "stripe_secret_key",
                                    "clear_stripe_secret_key", "stripe_webhook_secret", "clear_stripe_webhook_secret"})
    changed = [k for k, v in plain.items() if existing.get(k) != v]
    update = {**plain, "updated_at": now().isoformat(), "updated_by": admin["email"]}
    for field, clear in (("paypal_secret", req.clear_paypal_secret), ("stripe_secret_key", req.clear_stripe_secret_key),
                         ("stripe_webhook_secret", req.clear_stripe_webhook_secret)):
        if settings_store.apply_secret(update, existing, field, getattr(req, field), clear):
            changed.append(field)
    await settings_store.put(billing.SETTINGS_KEY, update)
    await audit(admin, "PAYMENTS_UPDATE", "changed=" + (",".join(changed) or "nothing"))
    return await payments_out()


@router.post("/payments/create-plans")
async def create_plans(req: PlanCreation, admin: dict = Depends(admin_user)):
    cfg = await billing.get_config()
    monthly, yearly = req.monthly.replace(",", "."), req.yearly.replace(",", ".")
    try:
        if req.provider == "paypal":
            if not (cfg.paypal_client_id and cfg.paypal_secret):
                raise HTTPException(status_code=400, detail="Enregistrez d'abord l'identifiant et le secret PayPal.")
            ids = await asyncio.to_thread(billing.create_paypal_plans, cfg, monthly, yearly)
            update = {"paypal_plan_monthly": ids["monthly"], "paypal_plan_yearly": ids["yearly"]}
        else:
            if not cfg.stripe_secret_key:
                raise HTTPException(status_code=400, detail="Enregistrez d'abord la clé secrète Stripe.")
            ids = await asyncio.to_thread(billing.create_stripe_prices, cfg, monthly, yearly)
            update = {"stripe_price_monthly": ids["monthly"], "stripe_price_yearly": ids["yearly"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Création refusée par {req.provider} : {e}"[:300])
    fr = lambda p: p.replace(".", ",") + " €"  # noqa: E731
    update.update(price_monthly_label=fr(monthly), price_yearly_label=fr(yearly),
                  updated_at=now().isoformat(), updated_by=admin["email"])
    await settings_store.put(billing.SETTINGS_KEY, update)
    await audit(admin, "PLANS_CREATE", f"provider={req.provider}; monthly={monthly}; yearly={yearly}")
    return await payments_out()


# ---------- E-mails ----------
class SmtpSettingsIn(BaseModel):
    host: str = Field(min_length=1, max_length=253, pattern=r"^[A-Za-z0-9.-]+$")
    port: int = Field(ge=1, le=65535)
    security: Literal["starttls", "ssl", "none"]
    username: str = Field("", max_length=254, pattern=r"^[^\r\n]*$")
    password: Optional[str] = Field(None, max_length=500)  # None conserve le mot de passe enregistré
    clear_password: bool = False
    from_address: EmailStr
    sender_name: str = Field("BreachRadar", min_length=1, max_length=100, pattern=r"^[^\r\n<>\"]*$")
    daily_limit: int = Field(mailer.DEFAULT_DAILY_LIMIT, ge=1, le=1_000_000)


class SmtpTest(BaseModel):
    to: Optional[EmailStr] = None
    service: Literal["primary", "fallback"] = "primary"


async def smtp_out() -> dict:
    doc = await settings_store.get(mailer.SETTINGS_KEY)
    primary, fallback, limit = await mailer.get_routes()
    return {
        "source": primary.source, "enabled": primary.enabled, "host": primary.host, "port": primary.port,
        "security": primary.security, "username": primary.username, "from_address": primary.from_address,
        "sender_name": primary.sender_name, "password_set": bool(primary.password),
        "password_unreadable": bool(doc and doc.get("password_encrypted") and not primary.password),
        "daily_limit": limit, "brevo_defaults": mailer.BREVO_DEFAULTS,
        "fallback": {"configured": fallback is not None, "label": fallback.label if fallback else ""},
        "updated_at": (doc or {}).get("updated_at"), "updated_by": (doc or {}).get("updated_by"),
        "usage": await mailer.usage(),
    }


@router.get("/smtp")
async def get_smtp(admin: dict = Depends(admin_user)):
    return await smtp_out()


@router.put("/smtp")
async def update_smtp(req: SmtpSettingsIn, admin: dict = Depends(admin_user)):
    existing = await settings_store.get(mailer.SETTINGS_KEY) or {}
    new = {"host": req.host.strip().lower(), "port": req.port, "security": req.security,
           "username": req.username.strip(), "from_address": str(req.from_address),
           "sender_name": req.sender_name.strip(), "daily_limit": req.daily_limit}
    changed = [k for k, v in new.items() if existing.get(k) != v]
    update = {**new, "updated_at": now().isoformat(), "updated_by": admin["email"]}
    if settings_store.apply_secret(update, existing, "password", req.password, req.clear_password):
        changed.append("password")
    await settings_store.put(mailer.SETTINGS_KEY, update)
    await audit(admin, "SMTP_UPDATE", "changed=" + (",".join(changed) or "nothing"))
    return await smtp_out()


@router.delete("/smtp")
async def reset_smtp(admin: dict = Depends(admin_user)):
    """Supprime la configuration enregistrée : les variables SMTP_* du .env s'appliquent à nouveau."""
    if await settings_store.delete(mailer.SETTINGS_KEY):
        await audit(admin, "SMTP_RESET")
    return await smtp_out()


@router.post("/smtp/test")
async def test_smtp(req: SmtpTest, admin: dict = Depends(admin_user)):
    primary, fallback, _ = await mailer.get_routes()
    cfg = primary if req.service == "primary" else fallback
    if cfg is None or not cfg.enabled:
        raise HTTPException(status_code=400, detail="Ce service d'envoi n'est pas configuré")
    to = str(req.to or admin["email"])
    body = mailer.layout("E-mail de test", "<p>La configuration d'envoi de BreachRadar fonctionne.</p>"
                                           f"<p>Serveur : {cfg.label} · Expéditeur : {cfg.from_address}</p>")
    try:
        await asyncio.to_thread(mailer.deliver, cfg, to, "E-mail de test - BreachRadar", body,
                                "La configuration d'envoi de BreachRadar fonctionne.")
    except Exception as exc:
        await audit(admin, "SMTP_TEST", f"to={to}; service={req.service}; result=error")
        raise HTTPException(status_code=400, detail=f"Erreur d'envoi : {mailer.error_text(cfg, exc)}")
    await audit(admin, "SMTP_TEST", f"to={to}; service={req.service}; result=ok")
    return {"sent_to": to, "service": req.service}


@router.get("/smtp/usage")
async def smtp_usage(admin: dict = Depends(admin_user)):
    return await mailer.usage()


# ---------- Indicateurs de la page d'accueil ----------
class StatsDisplay(BaseModel):
    mode: Literal["auto", "manual", "hidden"]
    value: int = Field(0, ge=0, le=100_000_000)
    label: str = Field(min_length=1, max_length=40)
    sub: str = Field("", max_length=80)


async def stats_display_out() -> dict:
    return {**await stats.monitored_display(),
            "real_value": await db.monitors.count_documents({"verified": True})}


@router.get("/stats-display")
async def get_stats_display(admin: dict = Depends(admin_user)):
    return await stats_display_out()


@router.put("/stats-display")
async def update_stats_display(req: StatsDisplay, admin: dict = Depends(admin_user)):
    values = {f"monitored_{k}": (v.strip() if isinstance(v, str) else v) for k, v in req.model_dump().items()}
    values.update(updated_at=now().isoformat(), updated_by=admin["email"])
    await settings_store.put(stats.DISPLAY_KEY, values)
    await audit(admin, "STATS_DISPLAY_UPDATE", f"mode={req.mode}; value={req.value}")
    return await stats_display_out()


# ---------- Informations légales et journal ----------
class LegalInfo(BaseModel):
    company_name: str = Field("", max_length=200)
    legal_form: str = Field("", max_length=100)
    capital: str = Field("", max_length=50)
    address: str = Field("", max_length=300)
    siret: str = Field("", max_length=30)
    rcs: str = Field("", max_length=100)
    vat_number: str = Field("", max_length=30)
    contact_email: str = Field("", max_length=254)
    phone: str = Field("", max_length=30)
    publication_director: str = Field("", max_length=100)
    host_name: str = Field("", max_length=200)
    host_address: str = Field("", max_length=300)
    host_phone: str = Field("", max_length=30)
    mediator_name: str = Field("", max_length=200)
    mediator_url: str = Field("", max_length=300, pattern=r"^(https?://\S+)?$")


@router.get("/legal")
async def get_legal_admin(admin: dict = Depends(admin_user)):
    doc = await settings_store.get(LEGAL_KEY) or {}
    return {f: doc.get(f, "") for f in LEGAL_FIELDS}


@router.put("/legal")
async def update_legal(req: LegalInfo, admin: dict = Depends(admin_user)):
    values = {k: v.strip() for k, v in req.model_dump().items()}
    await settings_store.put(LEGAL_KEY, {**values, "updated_at": now().isoformat(), "updated_by": admin["email"]})
    await audit(admin, "LEGAL_UPDATE")
    return values


@router.get("/audit")
async def audit_log(admin: dict = Depends(admin_user)):
    return await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@public_router.get("/legal")
async def public_legal():
    """Données affichées sur les pages Mentions légales, CGV et Confidentialité."""
    doc = await settings_store.get(LEGAL_KEY) or {}
    cfg = await billing.get_config()
    primary, fallback, _ = await mailer.get_routes()
    smtp_hosts = " ".join(c.host for c in (primary, fallback) if c and c.enabled)
    return {
        **{f: doc.get(f, "") for f in LEGAL_FIELDS},
        "site_url": mailer.public_url(),
        "prices": {"monthly": cfg.price_monthly_label, "yearly": cfg.price_yearly_label},
        "processors": {
            "paypal": cfg.paypal_ready, "stripe": cfg.stripe_ready,
            "brevo": "brevo" in smtp_hosts, "email_host": smtp_hosts,
            "ai": "anthropic" if ANTHROPIC_API_KEY else "emergent" if EMERGENT_LLM_KEY else None,
        },
        "updated_at": doc.get("updated_at"),
    }
