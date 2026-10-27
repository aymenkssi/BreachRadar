# Mots de passe, jetons de session (JWT) et identification du propriétaire des données
# (compte connecté, sinon navigateur anonyme via l'en-tête X-Client-Id).
import base64
import hashlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Request

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
TOKEN_DAYS = 30


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET doit faire au moins 32 caractères (openssl rand -hex 32)")
    return secret


def _prehash(password: str) -> bytes:
    # bcrypt ignore tout au-delà de 72 octets : on le nourrit d'un condensé de taille fixe.
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: str) -> str:
    issued = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "iat": issued, "exp": issued + timedelta(days=TOKEN_DAYS)},
                      _secret(), algorithm=JWT_ALGORITHM)


def decode_claims(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    except RuntimeError as e:
        logger.error(str(e))
        return None


def bearer_claims(request: Request) -> Optional[dict]:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return decode_claims(token)


def bearer_user_id(request: Request) -> Optional[str]:
    return (bearer_claims(request) or {}).get("sub")


def get_owner(request: Request) -> Optional[str]:
    user_id = bearer_user_id(request)
    if user_id:
        return f"user:{user_id}"
    try:
        return f"anon:{uuid.UUID(request.headers.get('X-Client-Id', ''))}"
    except ValueError:
        return None
