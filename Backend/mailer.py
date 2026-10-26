# Envoi des e-mails, comme Waselni :
#   - principal : configuration SMTP saisie dans l'admin (Brevo par défaut), limitée à daily_limit
#     envois par jour UTC (300 = offre gratuite Brevo) ;
#   - secours : variables SMTP_* du .env, au-delà de la limite ou si le principal refuse l'envoi.
# Sans configuration dans l'admin, le .env est le service principal (sans secours).
# Chaque envoi est compté par jour dans email_stats (indicateur de quota de l'admin).
import asyncio
import html
import logging
import os
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import List, Optional, Tuple

import settings_store
from server import db

logger = logging.getLogger(__name__)

SETTINGS_KEY = "smtp"
BREVO_DEFAULTS = {"host": "smtp-relay.brevo.com", "port": 587, "security": "starttls"}
DEFAULT_SENDER_NAME = "BreachRadar"
DEFAULT_DAILY_LIMIT = 300
HISTORY_DAYS = 14
SMTP_TIMEOUT_SECONDS = 15
_QUOTA_ERROR = re.compile(r"limit|quota|exceed|too many|rate", re.I)

# Remplacé dans les tests pour capturer les messages au lieu d'ouvrir une connexion SMTP
_transport = None


@dataclass(frozen=True)
class MailConfig:
    source: str  # "admin" | "env" | "none"
    host: str = ""
    port: int = 587
    security: str = "starttls"
    username: str = ""
    password: str = field(default="", repr=False)
    from_address: str = ""
    sender_name: str = DEFAULT_SENDER_NAME

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.from_address)

    @property
    def label(self) -> str:
        return f"{self.host}:{self.port}" if self.enabled else ""


def public_url() -> str:
    return os.environ.get("FRONTEND_URL", "https://breachradar.fr").rstrip("/")


def default_daily_limit() -> int:
    try:
        return max(1, int(os.environ.get("EMAIL_DAILY_LIMIT", DEFAULT_DAILY_LIMIT)))
    except ValueError:
        return DEFAULT_DAILY_LIMIT


def config_from_env() -> MailConfig:
    user, sender = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_FROM", "")
    if not (user and sender):
        return MailConfig(source="none")
    return MailConfig(
        source="env",
        host=os.environ.get("SMTP_HOST", BREVO_DEFAULTS["host"]),
        port=int(os.environ.get("SMTP_PORT", BREVO_DEFAULTS["port"])),
        security=os.environ.get("SMTP_SECURITY", BREVO_DEFAULTS["security"]),
        username=user,
        password=os.environ.get("SMTP_PASSWORD", ""),
        from_address=sender,
    )


def config_from_document(doc: dict) -> MailConfig:
    return MailConfig(
        source="admin",
        host=doc.get("host", ""),
        port=int(doc.get("port", 587)),
        security=doc.get("security", "starttls"),
        username=doc.get("username", ""),
        password=settings_store.decrypt_secret(doc.get("password_encrypted")),
        from_address=doc.get("from_address", ""),
        sender_name=doc.get("sender_name") or DEFAULT_SENDER_NAME,
    )


async def get_routes() -> Tuple[MailConfig, Optional[MailConfig], int]:
    """(service principal, service de secours ou None, limite journalière du principal)"""
    doc = await settings_store.get(SETTINGS_KEY)
    env = config_from_env()
    if doc:
        primary = config_from_document(doc)
        same = env.enabled and (env.host, env.username) == (primary.host, primary.username)
        limit = int(doc.get("daily_limit") or default_daily_limit())
        return primary, (env if env.enabled and not same else None), limit
    return env, None, default_daily_limit()


# ---------- Construction et envoi ----------
def build_message(cfg: MailConfig, to: str, subject: str, html_content: str, text: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((cfg.sender_name, cfg.from_address))
    msg["To"] = to
    msg["Subject"] = subject  # lève ValueError si l'objet contient un retour à la ligne
    msg["Message-ID"] = make_msgid(domain=cfg.from_address.rpartition("@")[2] or None)
    msg["Date"] = formatdate(usegmt=True)
    msg.set_content(text)
    msg.add_alternative(html_content, subtype="html")
    return msg


def deliver(cfg: MailConfig, to: str, subject: str, html_content: str, text: str) -> None:
    """Envoi synchrone avec une configuration donnée ; les erreurs remontent (e-mail de test)."""
    if not cfg.enabled:
        raise RuntimeError("Envoi d'e-mails non configuré")
    msg = build_message(cfg, to, subject, html_content, text)
    if _transport is not None:
        _transport(msg)
        return
    context = ssl.create_default_context()
    if cfg.security == "ssl":
        smtp = smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS, context=context)
    else:
        smtp = smtplib.SMTP(cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS)
    with smtp:
        if cfg.security == "starttls":
            smtp.starttls(context=context)
        if cfg.username:
            smtp.login(cfg.username, cfg.password)
        smtp.send_message(msg)


def error_text(cfg: MailConfig, exc: Exception) -> str:
    """Message affichable dans l'admin, sans secret."""
    text = f"{type(exc).__name__}: {exc}"
    if cfg.password:
        text = text.replace(cfg.password, "***")
    return text[:300]


# ---------- Quota journalier et bascule ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _ensure_day(day: str) -> None:
    await db.email_stats.update_one({"date": day}, {"$setOnInsert": {
        "date": day, "primary_sent": 0, "primary_failed": 0, "fallback_sent": 0, "fallback_failed": 0,
        "skipped": 0, "exhausted": False, "switched_at": None,
    }}, upsert=True)


async def _reserve_primary(day: str, limit: int) -> bool:
    """Réserve un envoi sur le quota du jour (atomique : deux envois simultanés ne dépassent pas la limite)."""
    await _ensure_day(day)
    doc = await db.email_stats.find_one_and_update(
        {"date": day, "exhausted": {"$ne": True}, "primary_sent": {"$lt": limit}},
        {"$inc": {"primary_sent": 1}},
    )
    return doc is not None


async def send(to: str, subject: str, html_content: str, text: str) -> bool:
    """Envoie en respectant le quota du principal ; renvoie False si aucun service n'a pu envoyer."""
    primary, fallback, limit = await get_routes()
    day = today_utc()
    if not primary.enabled and fallback is None:
        logger.warning(f"E-mails désactivés (SMTP non configuré) : « {subject} » non envoyé à {to}")
        await _ensure_day(day)
        await db.email_stats.update_one({"date": day}, {"$inc": {"skipped": 1}})
        return False

    if primary.enabled and await _reserve_primary(day, limit):
        try:
            await asyncio.to_thread(deliver, primary, to, subject, html_content, text)
            return True
        except Exception as exc:
            update = {"$inc": {"primary_sent": -1, "primary_failed": 1},
                      "$set": {"primary_last_error": {"at": _now_iso(), "message": error_text(primary, exc)}}}
            if _QUOTA_ERROR.search(str(exc)):
                update["$set"]["exhausted"] = True  # le fournisseur signale lui-même son quota
            await db.email_stats.update_one({"date": day}, update)
            logger.error(f"Échec de l'envoi par le service principal ({primary.label}) : {exc}")
    elif primary.enabled:
        logger.info(f"Limite journalière du service principal atteinte ({limit}/jour)")

    await _ensure_day(day)
    if fallback is None:
        await db.email_stats.update_one({"date": day}, {"$inc": {"skipped": 1}})
        return False
    first = await db.email_stats.find_one_and_update({"date": day, "switched_at": None},
                                                     {"$set": {"switched_at": _now_iso()}})
    if first is not None:
        logger.warning(f"Bascule vers le service e-mail de secours ({fallback.label}) pour aujourd'hui")
    try:
        await asyncio.to_thread(deliver, fallback, to, subject, html_content, text)
    except Exception as exc:
        await db.email_stats.update_one({"date": day}, {
            "$inc": {"fallback_failed": 1},
            "$set": {"fallback_last_error": {"at": _now_iso(), "message": error_text(fallback, exc)}}})
        logger.error(f"Échec de l'envoi par le service de secours ({fallback.label}) : {exc}")
        return False
    await db.email_stats.update_one({"date": day}, {"$inc": {"fallback_sent": 1}})
    return True


async def usage() -> dict:
    """Indicateur de l'admin : envois du jour, limite, service actif, historique."""
    primary, fallback, limit = await get_routes()
    now = datetime.now(timezone.utc)
    day = today_utc()
    start = (now - timedelta(days=HISTORY_DAYS - 1)).strftime("%Y-%m-%d")
    docs = {d["date"]: d async for d in db.email_stats.find({"date": {"$gte": start}}, {"_id": 0})}
    empty = {"primary_sent": 0, "primary_failed": 0, "fallback_sent": 0, "fallback_failed": 0, "skipped": 0,
             "exhausted": False, "switched_at": None, "primary_last_error": None, "fallback_last_error": None}
    today = {**empty, **docs.get(day, {})}
    history = []
    for i in range(HISTORY_DAYS - 1, -1, -1):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        h = {**empty, **docs.get(d, {})}
        history.append({"date": d, "primary_sent": h["primary_sent"], "fallback_sent": h["fallback_sent"],
                        "failed": h["primary_failed"] + h["fallback_failed"] + h["skipped"]})
    reached = today["exhausted"] or today["primary_sent"] >= limit
    return {
        "date": day,
        "limit": limit,
        "primary": {"label": primary.label, "source": primary.source, "sent": today["primary_sent"],
                    "failed": today["primary_failed"], "remaining": 0 if reached else limit - today["primary_sent"],
                    "last_error": today["primary_last_error"]},
        "fallback": {"configured": fallback is not None, "label": fallback.label if fallback else "",
                     "sent": today["fallback_sent"], "failed": today["fallback_failed"],
                     "last_error": today["fallback_last_error"]},
        "skipped": today["skipped"],
        "limit_reached": reached,
        "active": ("fallback" if fallback else "none") if reached else ("primary" if primary.enabled else "none"),
        "switched_at": today["switched_at"],
        "provider_quota_hit": today["exhausted"],
        "history": history,
    }


# ---------- Messages ----------
def layout(title: str, body_html: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
        f'<h2 style="color:#0f766e">{html.escape(title)}</h2>{body_html}'
        '<p style="margin-top:32px;font-size:12px;color:#666">BreachRadar AI · '
        f'<a href="{public_url()}">{public_url()}</a></p></div>'
    )


CODE_SUBJECTS = {
    "account": "Votre code de confirmation BreachRadar",
    "reset": "Réinitialisation de votre mot de passe BreachRadar",
    "monitor": "Confirmez la surveillance de votre adresse",
}
CODE_INTROS = {
    "account": "Voici le code pour confirmer la création de votre compte :",
    "reset": "Voici le code pour choisir un nouveau mot de passe :",
    "monitor": "Un compte BreachRadar souhaite surveiller cette adresse et vous alerter en cas de fuite. "
               "Si c'est bien vous, saisissez ce code :",
}


async def send_code(to: str, purpose: str, code: str, ttl_minutes: int) -> bool:
    intro = CODE_INTROS[purpose]
    body = (
        f"<p>{html.escape(intro)}</p>"
        f'<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{code}</p>'
        f"<p>Ce code expire dans {ttl_minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, "
        "ignorez ce message.</p>"
    )
    text = f"{intro}\n\n{code}\n\nCe code expire dans {ttl_minutes} minutes."
    return await send(to, CODE_SUBJECTS[purpose], layout(CODE_SUBJECTS[purpose], body), text)


async def send_breach_alert(to: str, monitored: str, new_breaches: List[str]) -> bool:
    subject = f"Alerte BreachRadar : nouvelle fuite pour {monitored}"
    items = "".join(f"<li>{html.escape(n)}</li>" for n in new_breaches)
    body = (
        f"<p>Votre adresse <b>{html.escape(monitored)}</b> apparaît dans "
        f"{len(new_breaches)} nouvelle(s) fuite(s) de données :</p><ul>{items}</ul>"
        "<p><b>À faire maintenant :</b> changez le mot de passe des services concernés et de tous les "
        "comptes où il est réutilisé, puis activez l'authentification à deux facteurs.</p>"
        f'<p><a href="{public_url()}">Voir le détail et le rapport des mots de passe</a></p>'
    )
    text = (
        f"Votre adresse {monitored} apparaît dans {len(new_breaches)} nouvelle(s) fuite(s) :\n"
        + "\n".join(f"- {n}" for n in new_breaches)
        + f"\n\nChangez les mots de passe concernés et activez la 2FA.\n{public_url()}"
    )
    return await send(to, subject, layout("Nouvelle fuite détectée", body), text)


async def send_renewal_reminder(to: str, renewal_date: str, price: str) -> bool:
    """Information préalable à la reconduction tacite (art. L215-1 du Code de la consommation)."""
    subject = "Votre abonnement BreachRadar Premium sera renouvelé"
    body = (
        "<p>Votre abonnement annuel BreachRadar Premium sera reconduit automatiquement le "
        f"<b>{html.escape(renewal_date)}</b> pour {html.escape(price)}.</p>"
        "<p>Vous pouvez vous opposer à cette reconduction en résiliant à tout moment avant cette date, depuis "
        f'<a href="{public_url()}">votre compte</a> (Mon compte → Abonnement → Résilier). '
        "Vous conserverez alors Premium jusqu'à la fin de la période déjà payée.</p>"
    )
    text = (f"Votre abonnement annuel BreachRadar Premium sera reconduit le {renewal_date} pour {price}.\n"
            f"Pour vous y opposer, résiliez avant cette date depuis votre compte : {public_url()}")
    return await send(to, subject, layout("Renouvellement de votre abonnement", body), text)
