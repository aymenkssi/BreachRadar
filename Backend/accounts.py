# Comptes utilisateurs : inscription avec code envoyé par e-mail, connexion, mot de passe oublié.
# Les codes à usage unique servent aussi à confirmer les adresses surveillées (premium.py).
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

import mailer
from security import bearer_user_id, create_token, hash_password, verify_password
from server import db

router = APIRouter(prefix="/api/auth", tags=["auth"])

CODE_TTL_MINUTES = 15
CODE_MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
LOGIN_MAX_FAILURES = 10
LOGIN_LOCK_MINUTES = 15


TERMS_VERSION = "2026-10"


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class Registration(Credentials):
    accept_terms: bool = False


class EmailOnly(BaseModel):
    email: EmailStr


class CodeCheck(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class PasswordReset(CodeCheck):
    password: str = Field(min_length=8, max_length=128)


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize(email: str) -> str:
    return email.strip().lower()


def is_admin(user: dict) -> bool:
    admins = {normalize(e) for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
    return bool(user.get("email_verified")) and user["email"] in admins


def is_premium(user: dict) -> bool:
    until = parse_dt(user.get("premium_until"))
    return bool(until and until > now())


def public_user(user: dict) -> dict:
    sub = user.get("subscription") or {}
    return {
        "id": user["id"],
        "email": user["email"],
        "premium": is_premium(user),
        "premium_until": user.get("premium_until"),
        "subscription": {"provider": sub.get("provider") or "paypal", "plan": sub.get("plan"),
                         "status": sub.get("status")} if sub else None,
        "is_admin": is_admin(user),
    }


# ---------- Codes à usage unique ----------
def _code_hash(key: str, code: str) -> str:
    return hashlib.sha256(f"{key}:{code}".encode()).hexdigest()


async def issue_code(recipient: str, purpose: str, scope: str = "") -> None:
    key = f"{purpose}:{recipient}:{scope}"
    existing = await db.email_codes.find_one({"key": key})
    if existing and (now() - parse_dt(existing["created_at"])).total_seconds() < RESEND_COOLDOWN_SECONDS:
        raise HTTPException(status_code=429, detail="Un code vient d'être envoyé, patientez une minute.")
    code = f"{secrets.randbelow(10 ** 6):06d}"
    await db.email_codes.update_one({"key": key}, {"$set": {
        "key": key,
        "code_hash": _code_hash(key, code),
        "attempts": 0,
        "created_at": now().isoformat(),
        "expires_at": (now() + timedelta(minutes=CODE_TTL_MINUTES)).isoformat(),
    }}, upsert=True)
    await mailer.send_code(recipient, purpose, code, CODE_TTL_MINUTES)


async def check_code(recipient: str, purpose: str, code: str, scope: str = "") -> bool:
    key = f"{purpose}:{recipient}:{scope}"
    doc = await db.email_codes.find_one({"key": key})
    if not doc or parse_dt(doc["expires_at"]) < now() or doc["attempts"] >= CODE_MAX_ATTEMPTS:
        return False
    if not hmac.compare_digest(doc["code_hash"], _code_hash(key, code.strip())):
        await db.email_codes.update_one({"key": key}, {"$inc": {"attempts": 1}})
        return False
    await db.email_codes.delete_one({"key": key})
    return True


# ---------- Dépendances ----------
async def current_user(request: Request) -> dict:
    user_id = bearer_user_id(request)
    user = await db.users.find_one({"id": user_id}, {"_id": 0}) if user_id else None
    if not user:
        raise HTTPException(status_code=401, detail="Connexion requise")
    return user


async def premium_user(user: dict = Depends(current_user)) -> dict:
    if not is_premium(user):
        raise HTTPException(status_code=402, detail="Fonction réservée aux abonnés Premium")
    return user


async def session(user: dict) -> dict:
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now().isoformat()}})
    return {"token": create_token(user["id"]), "user": public_user({**user, "email_verified": True})}


# ---------- Routes ----------
@router.post("/register")
async def register(req: Registration):
    if not req.accept_terms:
        raise HTTPException(status_code=400, detail="Vous devez accepter les CGV et la politique de confidentialité.")
    email = normalize(req.email)
    accepted = {"terms_accepted_at": now().isoformat(), "terms_version": TERMS_VERSION}
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and user.get("email_verified"):
        raise HTTPException(status_code=409, detail="Un compte existe déjà pour cette adresse.")
    if user:
        await db.users.update_one({"id": user["id"]},
                                  {"$set": {"password_hash": hash_password(req.password), **accepted}})
    else:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(req.password),
            "email_verified": False,
            "created_at": now().isoformat(),
            **accepted,
        })
    await issue_code(email, "account")
    return {"status": "code_sent"}


@router.post("/verify")
async def verify(req: CodeCheck):
    email = normalize(req.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not await check_code(email, "account", req.code):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
    return await session(user)


@router.post("/resend")
async def resend(req: EmailOnly):
    email = normalize(req.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and not user.get("email_verified"):
        await issue_code(email, "account")
    return {"status": "code_sent"}


@router.post("/login")
async def login(req: Credentials):
    email = normalize(req.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    locked_until = parse_dt(user.get("locked_until")) if user else None
    if locked_until and locked_until > now():
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessayez dans quelques minutes.")
    if not user or not verify_password(req.password, user["password_hash"]):
        if user:
            failures = user.get("login_failures", 0) + 1
            update = {"login_failures": failures}
            if failures >= LOGIN_MAX_FAILURES:
                update = {"login_failures": 0,
                          "locked_until": (now() + timedelta(minutes=LOGIN_LOCK_MINUTES)).isoformat()}
            await db.users.update_one({"id": user["id"]}, {"$set": update})
        raise HTTPException(status_code=401, detail="Adresse ou mot de passe incorrect.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"login_failures": 0, "locked_until": None}})
    if not user.get("email_verified"):
        try:
            await issue_code(email, "account")
        except HTTPException:
            pass  # un code récent est encore valable
        raise HTTPException(status_code=403, detail="email_not_verified")
    return await session(user)


@router.post("/forgot")
async def forgot(req: EmailOnly):
    email = normalize(req.email)
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        await issue_code(email, "reset")
    return {"status": "code_sent"}


@router.post("/reset")
async def reset(req: PasswordReset):
    email = normalize(req.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not await check_code(email, "reset", req.code):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(req.password), "email_verified": True,
        "login_failures": 0, "locked_until": None,
    }})
    return await session(user)


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)
