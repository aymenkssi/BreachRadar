# Fonctions Premium : veille d'adresses e-mail avec alerte dès qu'une nouvelle fuite est publiée,
# et rapport détaillé sur l'exposition des mots de passe. Une adresse n'est surveillée ou analysée
# qu'après preuve que l'abonné la contrôle (adresse du compte, ou code reçu sur l'adresse).
import asyncio
import logging
import os
import uuid
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import mailer
from ratelimit import limit
from accounts import check_code, current_user, is_premium, issue_code, normalize, now, premium_user
from server import Breach, db, gather_breaches

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/premium", tags=["premium"])

MONITOR_LIMIT = int(os.environ.get("MONITOR_LIMIT", "5"))
XON_DELAY_SECONDS = 1.5  # politesse envers l'API XposedOrNot entre deux adresses


class MonitorCreate(BaseModel):
    email: EmailStr


class MonitorCode(BaseModel):
    code: str = Field(min_length=6, max_length=6)


def public_monitor(m: dict) -> dict:
    return {k: m.get(k) for k in (
        "id", "email", "verified", "total_breaches", "new_breaches", "has_new", "last_checked", "created_at",
    )}


async def _get_monitor(monitor_id: str, user: dict) -> dict:
    m = await db.monitors.find_one({"id": monitor_id, "user_id": user["id"]}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Surveillance introuvable")
    return m


async def _breach_names(email: str) -> List[str]:
    result = await gather_breaches(email, "email", strict=True)
    return sorted({b.name for b in result["breaches"]})


async def _baseline(monitor: dict) -> dict:
    """Première lecture : les fuites déjà connues servent de référence, sans alerte."""
    update = {"verified": True}
    try:
        names = await _breach_names(monitor["email"])
        update.update(breach_names=names, total_breaches=len(names), last_checked=now().isoformat())
    except Exception as e:
        # La référence sera établie au prochain passage du planificateur
        logger.warning(f"Référence de fuites indisponible pour {monitor['email']} : {e}")
        update["needs_baseline"] = True
    await db.monitors.update_one({"id": monitor["id"]}, {"$set": update})
    return {**monitor, **update}


async def check_monitor(monitor: dict, user: dict) -> List[str]:
    """Compare les fuites actuelles à celles déjà connues ; alerte l'abonné s'il y en a de nouvelles."""
    names = await _breach_names(monitor["email"])
    update: Dict = {"breach_names": names, "total_breaches": len(names),
                    "last_checked": now().isoformat(), "needs_baseline": False}
    new = [] if monitor.get("needs_baseline") else sorted(set(names) - set(monitor.get("breach_names") or []))
    if new:
        update["new_breaches"] = sorted(set(monitor.get("new_breaches") or []) | set(new))
        update["has_new"] = True
        if await mailer.send_breach_alert(user["email"], monitor["email"], new):
            update["last_alert_at"] = now().isoformat()
    await db.monitors.update_one({"id": monitor["id"]}, {"$set": update})
    return new


async def run_monitor_checks() -> int:
    """Passe quotidienne du planificateur. Renvoie le nombre d'adresses avec de nouvelles fuites."""
    alerted = 0
    users: Dict[str, dict] = {}
    async for monitor in db.monitors.find({"verified": True}, {"_id": 0}):
        uid = monitor["user_id"]
        if uid not in users:
            users[uid] = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
        user = users[uid]
        if not user or not is_premium(user):
            continue
        try:
            if await check_monitor(monitor, user):
                alerted += 1
        except Exception as e:
            logger.error(f"Vérification de {monitor['email']} échouée : {e}")
        await asyncio.sleep(XON_DELAY_SECONDS)
    return alerted


# ---------- Veille ----------
@router.get("/monitors")
async def list_monitors(user: dict = Depends(current_user)):
    docs = await db.monitors.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return {"limit": MONITOR_LIMIT, "monitors": [public_monitor(m) for m in docs]}


@router.post("/monitors", dependencies=[Depends(limit("monitor-add", 20, 3600, per="user"))])
async def add_monitor(req: MonitorCreate, user: dict = Depends(premium_user)):
    email = normalize(req.email)
    if await db.monitors.find_one({"user_id": user["id"], "email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Cette adresse est déjà surveillée.")
    if await db.monitors.count_documents({"user_id": user["id"]}) >= MONITOR_LIMIT:
        raise HTTPException(status_code=400, detail=f"Limite de {MONITOR_LIMIT} adresses atteinte.")
    monitor = {
        "id": str(uuid.uuid4()), "user_id": user["id"], "email": email, "verified": False,
        "breach_names": [], "total_breaches": 0, "new_breaches": [], "has_new": False,
        "last_checked": None, "created_at": now().isoformat(),
    }
    await db.monitors.insert_one(dict(monitor))
    if email == user["email"]:
        monitor = await _baseline(monitor)  # adresse du compte : déjà vérifiée à l'inscription
    else:
        await issue_code(email, "monitor", scope=user["id"])
    return public_monitor(monitor)


@router.post("/monitors/{monitor_id}/verify", dependencies=[Depends(limit("monitor-code", 20, 3600, per="user"))])
async def verify_monitor(monitor_id: str, req: MonitorCode, user: dict = Depends(premium_user)):
    monitor = await _get_monitor(monitor_id, user)
    if monitor["verified"]:
        return public_monitor(monitor)
    if not await check_code(monitor["email"], "monitor", req.code, scope=user["id"]):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    return public_monitor(await _baseline(monitor))


@router.post("/monitors/{monitor_id}/resend", dependencies=[Depends(limit("monitor-code", 20, 3600, per="user"))])
async def resend_monitor_code(monitor_id: str, user: dict = Depends(premium_user)):
    monitor = await _get_monitor(monitor_id, user)
    if not monitor["verified"]:
        await issue_code(monitor["email"], "monitor", scope=user["id"])
    return {"status": "code_sent"}


@router.post("/monitors/{monitor_id}/seen")
async def mark_seen(monitor_id: str, user: dict = Depends(current_user)):
    monitor = await _get_monitor(monitor_id, user)
    await db.monitors.update_one({"id": monitor["id"]}, {"$set": {"has_new": False, "new_breaches": []}})
    return public_monitor({**monitor, "has_new": False, "new_breaches": []})


@router.delete("/monitors/{monitor_id}")
async def delete_monitor(monitor_id: str, user: dict = Depends(current_user)):
    await db.monitors.delete_one({"id": monitor_id, "user_id": user["id"]})
    return {"ok": True}


# ---------- Rapport des mots de passe ----------
PASSWORD_RISKS = {
    "plaintext": {
        "label": "Stocké en clair", "level": "critical",
        "advice": "Le mot de passe était lisible tel quel par les attaquants. Changez-le immédiatement, "
                  "ainsi que partout où vous l'avez réutilisé.",
    },
    "easytocrack": {
        "label": "Chiffrement faible", "level": "high",
        "advice": "Protégé par un hachage faible (MD5, SHA-1…) : il a très probablement été retrouvé. "
                  "Changez-le, ainsi que partout où vous l'avez réutilisé.",
    },
    "hardtocrack": {
        "label": "Chiffrement robuste", "level": "medium",
        "advice": "Protégé par un hachage robuste (bcrypt…) : difficile à retrouver, mais changez-le "
                  "par précaution s'il était faible ou réutilisé.",
    },
    "unknown": {
        "label": "Protection inconnue", "level": "medium",
        "advice": "Le service n'a pas indiqué comment le mot de passe était protégé : considérez-le "
                  "comme exposé et changez-le.",
    },
}
LEVEL_ORDER = ["critical", "high", "medium", "low"]


def _has_password(b: Breach) -> bool:
    return any("password" in d.lower() for d in b.exposed_data)


def password_entry(b: Breach) -> dict:
    risk = (b.password_risk or "unknown").lower()
    info = PASSWORD_RISKS.get(risk, PASSWORD_RISKS["unknown"])
    return {"breach": b.title or b.name, "domain": b.domain, "date": b.date, "records": b.exposed_records,
            "risk": risk if risk in PASSWORD_RISKS else "unknown", **info}


def build_password_report(email: str, breaches: List[Breach]) -> dict:
    entries = [password_entry(b) for b in breaches if _has_password(b)]
    entries.sort(key=lambda e: e["date"], reverse=True)  # plus récentes d'abord…
    entries.sort(key=lambda e: LEVEL_ORDER.index(e["level"]))  # …au sein de chaque niveau de gravité
    counts = {k: sum(1 for e in entries if e["risk"] == k) for k in PASSWORD_RISKS}
    level = entries[0]["level"] if entries else "low"
    actions = []
    if entries:
        actions = [
            "Changez le mot de passe de chaque service listé, en commençant par les plus critiques.",
            "N'utilisez plus jamais ces mots de passe, sur aucun site.",
            "Activez l'authentification à deux facteurs (2FA) sur vos comptes importants.",
            "Utilisez un gestionnaire de mots de passe pour avoir un mot de passe unique par site.",
        ]
        if counts["plaintext"] or counts["easytocrack"]:
            actions.insert(0, "Priorité absolue : vos mots de passe en clair ou faiblement chiffrés sont "
                              "probablement connus des attaquants.")
    return {
        "email": email,
        "generated_at": now().isoformat(),
        "total_breaches": len(breaches),
        "password_breaches": len(entries),
        "level": level,
        "counts": counts,
        "latest_password_leak": max((e["date"] for e in entries if e["date"]), default=""),
        "entries": entries,
        "actions": actions,
    }


@router.get("/password-report", dependencies=[Depends(limit("report-pwd", 30, 3600, per="user"))])
async def password_report(email: EmailStr, user: dict = Depends(premium_user)):
    email = normalize(email)
    owned = email == user["email"] or await db.monitors.find_one(
        {"user_id": user["id"], "email": email, "verified": True}, {"_id": 1})
    if not owned:
        raise HTTPException(status_code=403, detail="Adresse non vérifiée : ajoutez-la d'abord à votre veille.")
    try:
        result = await gather_breaches(email, "email", strict=True)
    except Exception:
        raise HTTPException(status_code=502, detail="Source de fuites indisponible, réessayez plus tard.")
    return build_password_report(email, result["breaches"])
