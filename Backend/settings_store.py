# Réglages modifiables depuis l'administration (collection platform_settings, un document par clé).
# Les secrets (mots de passe SMTP, clés PayPal/Stripe) y sont chiffrés et ne sont jamais renvoyés
# au navigateur : l'admin voit seulement s'ils sont définis.
import base64
import hashlib
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from server import db

logger = logging.getLogger(__name__)


def _fernet() -> Fernet:
    secret = os.environ.get("SETTINGS_ENCRYPTION_KEY") or os.environ.get("JWT_SECRET", "")
    key = hashlib.sha256(("breachradar-settings:" + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: Optional[str]) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        logger.error("Secret illisible (JWT_SECRET / SETTINGS_ENCRYPTION_KEY modifié ?) : à ressaisir dans l'admin")
        return ""


async def get(key: str) -> Optional[dict]:
    return await db.platform_settings.find_one({"key": key}, {"_id": 0})


async def put(key: str, values: dict) -> None:
    await db.platform_settings.update_one({"key": key}, {"$set": {"key": key, **values}}, upsert=True)


async def delete(key: str) -> bool:
    return (await db.platform_settings.delete_one({"key": key})).deleted_count > 0


def apply_secret(update: dict, existing: dict, field: str, value: Optional[str], clear: bool = False) -> bool:
    """None conserve le secret enregistré, une valeur le remplace, clear le supprime. Renvoie True si modifié."""
    enc = f"{field}_encrypted"
    if clear:
        update[enc] = None
        return bool(existing.get(enc))
    if value:
        update[enc] = encrypt_secret(value)
        return True
    return False
