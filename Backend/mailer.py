# Envoi des e-mails (SMTP, pré-réglé pour le relais Brevo comme Waselni).
# Variables : SMTP_HOST, SMTP_PORT, SMTP_SECURITY (starttls|ssl|none), SMTP_USER, SMTP_PASSWORD,
# SMTP_FROM. Sans SMTP_USER/SMTP_FROM, les e-mails sont désactivés (avertissement journalisé).
import asyncio
import html
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import List

logger = logging.getLogger(__name__)

SENDER_NAME = "BreachRadar"
SMTP_TIMEOUT_SECONDS = 15

# Remplacé dans les tests pour capturer les messages au lieu d'ouvrir une connexion SMTP
_transport = None


def public_url() -> str:
    return os.environ.get("FRONTEND_URL", "https://breachradar.fr").rstrip("/")


def _config() -> dict:
    return {
        "host": os.environ.get("SMTP_HOST", "smtp-relay.brevo.com"),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "security": os.environ.get("SMTP_SECURITY", "starttls"),
        "user": os.environ.get("SMTP_USER", ""),
        "password": os.environ.get("SMTP_PASSWORD", ""),
        "from": os.environ.get("SMTP_FROM", ""),
    }


def _layout(title: str, body_html: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
        f'<h2 style="color:#0f766e">{html.escape(title)}</h2>{body_html}'
        '<p style="margin-top:32px;font-size:12px;color:#666">BreachRadar AI · '
        f'<a href="{public_url()}">{public_url()}</a></p></div>'
    )


def _send_sync(to: str, subject: str, html_content: str, text: str) -> bool:
    cfg = _config()
    msg = EmailMessage()
    msg["From"] = formataddr((SENDER_NAME, cfg["from"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=cfg["from"].rpartition("@")[2] or None)
    msg["Date"] = formatdate(usegmt=True)
    msg.set_content(text)
    msg.add_alternative(html_content, subtype="html")
    if _transport is not None:
        _transport(msg)
        return True
    if not (cfg["user"] and cfg["from"]):
        logger.warning(f"E-mails désactivés (SMTP non configuré) : « {subject} » non envoyé à {to}")
        return False
    try:
        if cfg["security"] == "ssl":
            smtp = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=SMTP_TIMEOUT_SECONDS,
                                    context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(cfg["host"], cfg["port"], timeout=SMTP_TIMEOUT_SECONDS)
        with smtp:
            if cfg["security"] == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            smtp.login(cfg["user"], cfg["password"])
            smtp.send_message(msg)
        return True
    except Exception as e:
        logger.error(f"Envoi d'e-mail échoué ({to}) : {e}")
        return False


async def send(to: str, subject: str, html_content: str, text: str) -> bool:
    return await asyncio.to_thread(_send_sync, to, subject, html_content, text)


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
    return await send(to, CODE_SUBJECTS[purpose], _layout(CODE_SUBJECTS[purpose], body), text)


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
    return await send(to, subject, _layout("Nouvelle fuite détectée", body), text)
