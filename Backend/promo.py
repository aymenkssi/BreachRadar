# Codes promo créés dans l'administration et saisis par le client avant le paiement.
#  - percent / amount : réduction en % ou en € sur la première échéance (once), pendant N mois
#    (repeating) ou sur toute la durée (forever). Stripe applique un coupon ; PayPal n'a pas de coupon
#    d'abonnement : le prix réduit y est fixé à la création de l'abonnement, donc seulement « forever ».
#  - free : N jours de Premium offerts, sans paiement.
# Chaque code peut être limité à une formule, à un nombre d'utilisations et à une date ; un compte
# ne peut utiliser un code qu'une fois.
import hashlib
import re
import secrets
import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from pymongo.errors import DuplicateKeyError

from ratelimit import limit
from accounts import admin_user, audit, current_user, now, parse_dt, public_user
from server import db

router = APIRouter(prefix="/api/admin/promos", tags=["promos"])
public_router = APIRouter(prefix="/api/billing/promo", tags=["promos"])

PLANS = ("monthly", "yearly")
PLAN_LABELS = {"monthly": "mensuelle", "yearly": "annuelle"}
MIN_PAYPAL_PRICE = Decimal("0.50")  # PayPal refuse un abonnement à (presque) 0 € ; Stripe accepte 0 €
CODE_PATTERN = r"^[A-Z0-9_-]{3,32}$"


def normalize_code(code: str) -> str:
    return re.sub(r"\s+", "", code or "").upper()


def parse_price(label: str) -> Optional[Decimal]:
    m = re.search(r"\d+(?:[.,]\d{1,2})?", label or "")
    return Decimal(m.group(0).replace(",", ".")) if m else None


def fmt_eur(value: Decimal) -> str:
    return f"{value:.2f}".replace(".", ",") + " €"


def discounted(promo: dict, price: Decimal) -> Decimal:
    value = Decimal(str(promo["value"]))
    result = price * (100 - value) / 100 if promo["kind"] == "percent" else price - value
    return max(result, Decimal(0)).quantize(Decimal("0.01"), ROUND_HALF_UP)


def describe(promo: dict) -> str:
    if promo["kind"] == "free":
        return f"{promo['days']} jours de Premium offerts"
    value = Decimal(str(promo["value"]))
    amount = f"-{value.normalize():f} %".replace(".", ",") if promo["kind"] == "percent" else f"-{fmt_eur(value)}"
    period = {"once": "sur la première échéance", "forever": "sur toute la durée de l'abonnement",
              "repeating": f"pendant {promo.get('duration_months')} mois"}[promo["duration"]]
    return f"{amount} {period}"


def paypal_compatible(promo: dict) -> bool:
    return promo["kind"] != "free" and promo["duration"] == "forever"


def public_promo(p: dict) -> dict:
    return {k: p.get(k) for k in ("id", "code", "kind", "value", "duration", "duration_months", "days", "plans",
                                  "max_redemptions", "expires_at", "active", "note", "redemptions", "created_at",
                                  "created_by")} | {"description": describe(p)}


async def find_valid(code: str, user: dict, plan: Optional[str] = None) -> dict:
    """Renvoie le code s'il est utilisable par ce compte (et cette formule), sinon lève une erreur 400."""
    promo = await db.promo_codes.find_one({"code": normalize_code(code)}, {"_id": 0})
    if not promo or not promo.get("active"):
        raise HTTPException(status_code=400, detail="Code promo invalide.")
    expires = parse_dt(promo.get("expires_at"))
    if expires and expires < now():
        raise HTTPException(status_code=400, detail="Ce code promo a expiré.")
    if promo.get("max_redemptions") and promo.get("redemptions", 0) >= promo["max_redemptions"]:
        raise HTTPException(status_code=400, detail="Ce code promo n'est plus disponible.")
    if await db.promo_redemptions.find_one({"code": promo["code"], "user_id": user["id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Vous avez déjà utilisé ce code promo.")
    if plan and promo["kind"] != "free" and plan not in promo.get("plans", PLANS):
        raise HTTPException(status_code=400,
                            detail=f"Ce code ne s'applique pas à la formule {PLAN_LABELS.get(plan, plan)}.")
    return promo


async def record_redemption(promo: dict, user: dict, provider: str) -> None:
    """Enregistre l'utilisation (une fois par compte, même si le paiement est confirmé deux fois)."""
    try:
        await db.promo_redemptions.insert_one({"code": promo["code"], "user_id": user["id"], "email": user["email"],
                                               "provider": provider, "at": now().isoformat()})
    except DuplicateKeyError:
        return
    await db.promo_codes.update_one({"code": promo["code"]}, {"$inc": {"redemptions": 1}})


def stripe_coupon_params(promo: dict) -> dict:
    params = {"name": promo["code"], "duration": promo["duration"], "metadata": {"promo_code": promo["code"]}}
    if promo["kind"] == "percent":
        params["percent_off"] = float(promo["value"])
    else:
        params.update(amount_off=int(Decimal(str(promo["value"])) * 100), currency="eur")
    if promo["duration"] == "repeating":
        params["duration_in_months"] = promo["duration_months"]
    return params


def key_fingerprint(secret_key: str) -> str:
    return hashlib.sha256(secret_key.encode()).hexdigest()[:16]


# ---------- Client ----------
class PromoCheck(BaseModel):
    code: str = Field(max_length=40)
    plan: Literal["monthly", "yearly"] = "monthly"


@public_router.post("/check", dependencies=[Depends(limit("promo", 20, 3600, per="user"))])
async def check(req: PromoCheck, user: dict = Depends(current_user)):
    import billing  # import local : billing utilise aussi ce module
    promo = await find_valid(req.code, user, req.plan)
    out = {"code": promo["code"], "kind": promo["kind"], "description": describe(promo)}
    if promo["kind"] == "free":
        return out
    cfg = await billing.get_config()
    label = cfg.price_monthly_label if req.plan == "monthly" else cfg.price_yearly_label
    price = parse_price(label)
    if price is None:
        raise HTTPException(status_code=400, detail="Prix de la formule non configuré.")
    after = discounted(promo, price)
    stripe_ok = cfg.stripe_ready
    paypal_ok = cfg.paypal_ready and paypal_compatible(promo) and after >= MIN_PAYPAL_PRICE
    if (cfg.stripe_ready or cfg.paypal_ready) and not (stripe_ok or paypal_ok):
        # Seul PayPal est proposé et le code n'y est pas utilisable : on dit pourquoi
        if not paypal_compatible(promo):
            detail = ("Ce code porte sur une durée limitée : il ne s'applique qu'au paiement par carte "
                      "bancaire (Stripe), qui n'est pas proposé pour le moment.")
        else:
            detail = "Avec PayPal, le prix réduit doit rester d'au moins 0,50 €."
        raise HTTPException(status_code=400, detail=detail)
    return {**out, "price_before": fmt_eur(price), "price_after": fmt_eur(after),
            "stripe": stripe_ok, "paypal": paypal_ok}


class PromoRedeem(BaseModel):
    code: str = Field(max_length=40)


@public_router.post("/redeem", dependencies=[Depends(limit("promo", 20, 3600, per="user"))])
async def redeem(req: PromoRedeem, user: dict = Depends(current_user)):
    """Code « accès offert » : prolonge Premium sans paiement."""
    promo = await find_valid(req.code, user)
    if promo["kind"] != "free":
        raise HTTPException(status_code=400, detail="Ce code s'applique au moment du paiement.")
    current = parse_dt(user.get("premium_until"))
    start = max(current, now()) if current else now()
    until = (start + timedelta(days=promo["days"])).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "premium_until": until,
        "manual_premium": {"until": until, "by": f"code {promo['code']}", "at": now().isoformat(), "note": ""},
    }})
    await record_redemption(promo, user, "free")
    return public_user({**user, "premium_until": until})


# ---------- Administration ----------
class PromoIn(BaseModel):
    code: str = Field("", max_length=32)  # vide : code généré automatiquement
    kind: Literal["percent", "amount", "free"]
    value: float = Field(0, ge=0, le=1000)
    duration: Literal["once", "repeating", "forever"] = "once"
    duration_months: Optional[int] = Field(None, ge=1, le=36)
    days: Optional[int] = Field(None, ge=1, le=3650)
    plans: List[Literal["monthly", "yearly"]] = list(PLANS)
    max_redemptions: Optional[int] = Field(None, ge=1, le=1_000_000)
    expires_at: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str = Field("", max_length=200)

    @model_validator(mode="after")
    def check_values(self):
        if self.kind == "percent" and not 1 <= self.value <= 100:
            raise ValueError("Réduction en % : entre 1 et 100.")
        if self.kind == "percent" and self.value == 100 and self.duration == "forever":
            raise ValueError("100 % sur toute la durée : utilisez plutôt un code « accès offert ».")
        if self.kind == "amount" and not 0.5 <= self.value <= 1000:
            raise ValueError("Réduction en € : entre 0,50 et 1 000.")
        if self.kind == "free" and not self.days:
            raise ValueError("Indiquez le nombre de jours offerts.")
        if self.kind != "free" and self.duration == "repeating" and not self.duration_months:
            raise ValueError("Indiquez le nombre de mois de réduction.")
        if not self.plans:
            raise ValueError("Choisissez au moins une formule.")
        return self


class PromoUpdate(BaseModel):
    active: bool


@router.get("")
async def list_promos(admin: dict = Depends(admin_user)):
    docs = await db.promo_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [public_promo(p) for p in docs]


@router.post("")
async def create_promo(req: PromoIn, admin: dict = Depends(admin_user)):
    code = normalize_code(req.code) or "BR-" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
                                                       for _ in range(8))
    if not re.match(CODE_PATTERN, code):
        raise HTTPException(status_code=400, detail="Code : 3 à 32 caractères parmi A-Z, 0-9, - et _.")
    expires = None
    if req.expires_at:
        expires = datetime.combine(datetime.strptime(req.expires_at, "%Y-%m-%d").date(), time(23, 59, 59),
                                   timezone.utc)
        if expires <= now():
            raise HTTPException(status_code=400, detail="La date d'expiration doit être dans le futur.")
    promo = {
        "id": str(uuid.uuid4()), "code": code, "kind": req.kind, "value": req.value if req.kind != "free" else 0,
        "duration": req.duration if req.kind != "free" else "once",
        "duration_months": req.duration_months if req.kind != "free" and req.duration == "repeating" else None,
        "days": req.days if req.kind == "free" else None, "plans": sorted(set(req.plans)),
        "max_redemptions": req.max_redemptions, "expires_at": expires.isoformat() if expires else None,
        "active": True, "note": req.note.strip(), "redemptions": 0,
        "created_at": now().isoformat(), "created_by": admin["email"],
    }
    try:
        await db.promo_codes.insert_one(dict(promo))
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ce code existe déjà.")
    await audit(admin, "PROMO_CREATE", f"code={code}; {describe(promo)}")
    return public_promo(promo)


@router.patch("/{promo_id}")
async def update_promo(promo_id: str, req: PromoUpdate, admin: dict = Depends(admin_user)):
    promo = await db.promo_codes.find_one_and_update({"id": promo_id}, {"$set": {"active": req.active}},
                                                     projection={"_id": 0}, return_document=True)
    if not promo:
        raise HTTPException(status_code=404, detail="Code introuvable")
    await audit(admin, "PROMO_UPDATE", f"code={promo['code']}; active={req.active}")
    return public_promo(promo)


@router.delete("/{promo_id}")
async def delete_promo(promo_id: str, admin: dict = Depends(admin_user)):
    promo = await db.promo_codes.find_one_and_delete({"id": promo_id}, projection={"_id": 0})
    if promo:
        await audit(admin, "PROMO_DELETE", f"code={promo['code']}")
    return {"ok": True}


@router.get("/{promo_id}/redemptions")
async def redemptions(promo_id: str, admin: dict = Depends(admin_user)):
    promo = await db.promo_codes.find_one({"id": promo_id}, {"_id": 0, "code": 1})
    if not promo:
        raise HTTPException(status_code=404, detail="Code introuvable")
    return await db.promo_redemptions.find({"code": promo["code"]}, {"_id": 0}).sort("at", -1).to_list(1000)
