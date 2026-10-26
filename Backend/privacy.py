# Droits RGPD de l'utilisateur (export et suppression de ses données) et durées de conservation
# appliquées chaque jour par le planificateur (voir la politique de confidentialité).
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import billing
from accounts import current_user, is_premium, now
from security import verify_password
from server import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["privacy"])

ANONYMOUS_HISTORY_DAYS = 180
UNVERIFIED_ACCOUNT_DAYS = 7
INACTIVE_ACCOUNT_DAYS = 3 * 365
STATS_DAYS = 400


class AccountDeletion(BaseModel):
    password: str


async def delete_user_data(user: dict) -> None:
    """Supprime le compte et tout ce qui lui est rattaché ; résilie l'abonnement en cours si possible."""
    if (user.get("subscription") or {}).get("status") in billing.CANCELLABLE:
        try:
            await billing.cancel_user_subscription(user)
        except Exception as e:
            logger.error(f"Résiliation avant suppression du compte {user['email']} échouée : {e}")
    owner = f"user:{user['id']}"
    await db.monitors.delete_many({"user_id": user["id"]})
    await db.investigations.delete_many({"owner": owner})
    await db.watchlist.delete_many({"owner": owner})
    await db.email_codes.delete_many({"key": {"$regex": f":{user['email']}:"}})
    await db.users.delete_one({"id": user["id"]})


@router.get("/export")
async def export_data(user: dict = Depends(current_user)):
    owner = f"user:{user['id']}"
    account = {k: v for k, v in user.items() if k not in ("password_hash", "login_failures", "locked_until")}
    return {
        "exported_at": now().isoformat(),
        "account": account,
        "monitors": await db.monitors.find({"user_id": user["id"]}, {"_id": 0, "user_id": 0}).to_list(1000),
        "investigations": await db.investigations.find({"owner": owner}, {"_id": 0, "owner": 0}).to_list(1000),
        "watchlist": await db.watchlist.find({"owner": owner}, {"_id": 0, "owner": 0}).to_list(1000),
    }


@router.delete("/account")
async def delete_account(req: AccountDeletion, user: dict = Depends(current_user)):
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Mot de passe incorrect.")
    await delete_user_data(user)
    return {"ok": True}


async def purge_expired_data() -> dict:
    """Applique les durées de conservation annoncées dans la politique de confidentialité."""
    t = now()
    counts = {}
    cutoff = (t - timedelta(days=ANONYMOUS_HISTORY_DAYS)).isoformat()
    for coll in ("investigations", "watchlist"):
        r = await db[coll].delete_many({"owner": {"$not": {"$regex": "^user:"}}, "created_at": {"$lt": cutoff}})
        counts[f"anonymous_{coll}"] = r.deleted_count
    r = await db.users.delete_many({"email_verified": False,
                                    "created_at": {"$lt": (t - timedelta(days=UNVERIFIED_ACCOUNT_DAYS)).isoformat()}})
    counts["unverified_accounts"] = r.deleted_count
    inactive_cutoff = (t - timedelta(days=INACTIVE_ACCOUNT_DAYS)).isoformat()
    inactive = 0
    async for user in db.users.find({"$or": [
        {"last_login_at": {"$lt": inactive_cutoff}},
        {"last_login_at": {"$exists": False}, "created_at": {"$lt": inactive_cutoff}},
    ]}, {"_id": 0}):
        if not is_premium(user):
            await delete_user_data(user)
            inactive += 1
    counts["inactive_accounts"] = inactive
    r = await db.email_codes.delete_many({"expires_at": {"$lt": t.isoformat()}})
    counts["expired_codes"] = r.deleted_count
    stats_cutoff = (t - timedelta(days=STATS_DAYS))
    await db.email_stats.delete_many({"date": {"$lt": stats_cutoff.strftime("%Y-%m-%d")}})
    await db.audit_logs.delete_many({"created_at": {"$lt": stats_cutoff.isoformat()}})
    return counts
