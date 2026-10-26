import re
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import accounts
import billing
import mailer
import main
import premium
import server
from server import Breach


@pytest.fixture
def env(monkeypatch):
    db = AsyncMongoMockClient()["test"]
    for module in (server, main, accounts, billing, premium):
        monkeypatch.setattr(module, "db", db)
    sent = []
    monkeypatch.setattr(mailer, "_transport", sent.append)
    breaches = {}  # adresse -> liste de Breach, ou exception à lever

    async def fake_gather(target, ttype, strict=False):
        value = breaches.get(target, [])
        if isinstance(value, Exception):
            raise value
        return {"breaches": value, "risk_score": 0, "risk_label": ""}

    monkeypatch.setattr(server, "gather_breaches", fake_gather)
    monkeypatch.setattr(premium, "gather_breaches", fake_gather)
    monkeypatch.setattr(premium, "XON_DELAY_SECONDS", 0)
    with TestClient(main.app) as client:
        yield {"client": client, "db": db, "sent": sent, "breaches": breaches}


def last_code(sent, to):
    msg = next(m for m in reversed(sent) if m["To"] == to)
    return re.search(r"\b(\d{6})\b", msg.get_body(("plain",)).get_content()).group(1)


def signup(env, email="alice@example.com", password="motdepasse1"):
    c = env["client"]
    assert c.post("/api/auth/register", json={"email": email, "password": password}).status_code == 200
    r = c.post("/api/auth/verify", json={"email": email, "code": last_code(env["sent"], email)})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def make_premium(env, email="alice@example.com", days=30):
    until = (accounts.now() + timedelta(days=days)).isoformat()
    env["client"].portal.call(env["db"].users.update_one, {"email": email}, {"$set": {"premium_until": until}})


def breach(name, risk="plaintext", data=("Passwords", "Email addresses"), date="2022-01-01"):
    return Breach(name=name, title=name, password_risk=risk, exposed_data=list(data), date=date)


# ---------- Comptes ----------
def test_signup_login_and_me(env):
    c = env["client"]
    headers = signup(env)
    me = c.get("/api/auth/me", headers=headers).json()
    assert me["email"] == "alice@example.com" and me["premium"] is False
    r = c.post("/api/auth/login", json={"email": "ALICE@example.com", "password": "motdepasse1"})
    assert r.status_code == 200 and r.json()["token"]
    assert c.post("/api/auth/login", json={"email": "alice@example.com", "password": "mauvais123"}).status_code == 401
    assert c.post("/api/auth/register", json={"email": "alice@example.com", "password": "autre1234"}).status_code == 409


def test_login_requires_verified_email(env):
    c = env["client"]
    c.post("/api/auth/register", json={"email": "bob@example.com", "password": "motdepasse1"})
    r = c.post("/api/auth/login", json={"email": "bob@example.com", "password": "motdepasse1"})
    assert r.status_code == 403 and r.json()["detail"] == "email_not_verified"


def test_code_attempts_are_limited(env):
    c = env["client"]
    c.post("/api/auth/register", json={"email": "bob@example.com", "password": "motdepasse1"})
    good = last_code(env["sent"], "bob@example.com")
    wrong = "000000" if good != "000000" else "111111"
    for _ in range(accounts.CODE_MAX_ATTEMPTS):
        assert c.post("/api/auth/verify", json={"email": "bob@example.com", "code": wrong}).status_code == 400
    assert c.post("/api/auth/verify", json={"email": "bob@example.com", "code": good}).status_code == 400


def test_password_reset(env):
    c = env["client"]
    signup(env)
    env["sent"].clear()
    c.post("/api/auth/forgot", json={"email": "alice@example.com"})
    code = last_code(env["sent"], "alice@example.com")
    r = c.post("/api/auth/reset", json={"email": "alice@example.com", "code": code, "password": "nouveau1234"})
    assert r.status_code == 200
    assert c.post("/api/auth/login", json={"email": "alice@example.com", "password": "nouveau1234"}).status_code == 200


def test_forgot_does_not_reveal_unknown_address(env):
    r = env["client"].post("/api/auth/forgot", json={"email": "inconnu@example.com"})
    assert r.status_code == 200 and env["sent"] == []


# ---------- Historique privé ----------
def test_history_is_private_per_browser(env):
    c = env["client"]
    a, b = {"X-Client-Id": str(uuid.uuid4())}, {"X-Client-Id": str(uuid.uuid4())}
    inv = c.post("/api/investigate", json={"target": "example.com"}, headers=a).json()
    assert len(c.get("/api/history", headers=a).json()) == 1
    assert c.get("/api/history", headers=b).json() == []
    assert c.get("/api/history").json() == []
    assert c.get(f"/api/investigation/{inv['id']}", headers=b).status_code == 404
    c.delete("/api/history", headers=b)
    assert len(c.get("/api/history", headers=a).json()) == 1


# ---------- Veille ----------
def test_monitoring_requires_premium(env):
    headers = signup(env)
    r = env["client"].post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers)
    assert r.status_code == 402


def test_monitor_own_address_and_alert_on_new_breach(env):
    c, sent = env["client"], env["sent"]
    headers = signup(env)
    make_premium(env)
    env["breaches"]["alice@example.com"] = [breach("Ancienne")]
    m = c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers).json()
    assert m["verified"] and m["total_breaches"] == 1

    sent.clear()
    assert c.portal.call(premium.run_monitor_checks) == 0
    assert sent == []  # fuite déjà connue : pas d'alerte

    env["breaches"]["alice@example.com"] = [breach("Ancienne"), breach("Nouvelle")]
    assert c.portal.call(premium.run_monitor_checks) == 1
    assert len(sent) == 1 and "Nouvelle" in sent[0].get_body(("plain",)).get_content()
    monitors = c.get("/api/premium/monitors", headers=headers).json()["monitors"]
    assert monitors[0]["has_new"] and monitors[0]["new_breaches"] == ["Nouvelle"]


def test_source_outage_does_not_trigger_false_alerts(env):
    c, sent = env["client"], env["sent"]
    headers = signup(env)
    make_premium(env)
    env["breaches"]["alice@example.com"] = [breach("Ancienne")]
    c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers)
    sent.clear()
    env["breaches"]["alice@example.com"] = RuntimeError("XON indisponible")
    assert c.portal.call(premium.run_monitor_checks) == 0
    m = c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers)
    assert m.status_code == 409
    env["breaches"]["alice@example.com"] = [breach("Ancienne")]
    assert c.portal.call(premium.run_monitor_checks) == 0
    assert sent == []


def test_other_address_needs_code_sent_to_that_address(env):
    c, sent = env["client"], env["sent"]
    headers = signup(env)
    make_premium(env)
    m = c.post("/api/premium/monitors", json={"email": "pro@example.org"}, headers=headers).json()
    assert m["verified"] is False and sent[-1]["To"] == "pro@example.org"
    r = c.get("/api/premium/password-report", params={"email": "pro@example.org"}, headers=headers)
    assert r.status_code == 403
    code = last_code(sent, "pro@example.org")
    r = c.post(f"/api/premium/monitors/{m['id']}/verify", json={"code": code}, headers=headers)
    assert r.json()["verified"] is True
    r = c.get("/api/premium/password-report", params={"email": "pro@example.org"}, headers=headers)
    assert r.status_code == 200


def test_unverified_monitors_are_not_checked_and_limit_applies(env, monkeypatch):
    c = env["client"]
    headers = signup(env)
    make_premium(env)
    monkeypatch.setattr(premium, "MONITOR_LIMIT", 1)
    c.post("/api/premium/monitors", json={"email": "x@example.org"}, headers=headers)
    r = c.post("/api/premium/monitors", json={"email": "y@example.org"}, headers=headers)
    assert r.status_code == 400
    env["breaches"]["x@example.org"] = [breach("Fuite")]
    env["sent"].clear()
    assert c.portal.call(premium.run_monitor_checks) == 0 and env["sent"] == []


def test_expired_premium_stops_alerts(env):
    c = env["client"]
    headers = signup(env)
    make_premium(env)
    c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers)
    make_premium(env, days=-1)
    env["breaches"]["alice@example.com"] = [breach("Nouvelle")]
    assert c.portal.call(premium.run_monitor_checks) == 0


# ---------- Rapport des mots de passe ----------
def test_password_report_content(env):
    c = env["client"]
    headers = signup(env)
    make_premium(env)
    env["breaches"]["alice@example.com"] = [
        breach("Robuste", risk="hardtocrack", date="2023-05-01"),
        breach("EnClair", risk="plaintext", date="2019-01-01"),
        breach("SansMotDePasse", data=("Email addresses",)),
    ]
    report = c.get("/api/premium/password-report", params={"email": "alice@example.com"}, headers=headers).json()
    assert report["password_breaches"] == 2 and report["total_breaches"] == 3
    assert [e["breach"] for e in report["entries"]] == ["EnClair", "Robuste"]
    assert report["level"] == "critical" and report["counts"]["plaintext"] == 1
    assert "Priorité absolue" in report["actions"][0]
    assert "password" not in str(report["entries"][0].keys())  # aucun mot de passe renvoyé


def test_password_report_requires_premium(env):
    headers = signup(env)
    r = env["client"].get("/api/premium/password-report", params={"email": "alice@example.com"}, headers=headers)
    assert r.status_code == 402


# ---------- Abonnement PayPal ----------
@pytest.fixture
def paypal(monkeypatch):
    monkeypatch.setattr(billing, "PAYPAL_CLIENT_ID", "client")
    monkeypatch.setattr(billing, "PAYPAL_SECRET", "secret")
    monkeypatch.setattr(billing, "PAYPAL_WEBHOOK_ID", "wh")
    monkeypatch.setitem(billing.PLANS["monthly"], "plan_id", "P-MONTH")
    monkeypatch.setitem(billing.PLANS["yearly"], "plan_id", "P-YEAR")
    subs = {}

    async def fake_paypal(method, path, json=None):
        if path == "/v1/notifications/verify-webhook-signature":
            return {"verification_status": "SUCCESS"}
        sub_id = path.split("/")[4]
        if path.endswith("/cancel"):
            subs[sub_id]["status"] = "CANCELLED"
            return None
        return subs[sub_id]

    monkeypatch.setattr(billing, "paypal", fake_paypal)
    return subs


def user_id(env, email="alice@example.com"):
    return env["client"].portal.call(env["db"].users.find_one, {"email": email})["id"]


def test_subscription_activation_and_webhooks(env, paypal):
    c = env["client"]
    headers = signup(env)
    paypal["I-1"] = {"id": "I-1", "plan_id": "P-YEAR", "status": "ACTIVE", "custom_id": user_id(env),
                     "billing_info": {"next_billing_time": "2099-01-01T00:00:00Z"}}
    assert c.get("/api/billing/config").json()["enabled"] is True
    me = c.post("/api/billing/paypal/subscription", json={"subscription_id": "I-1"}, headers=headers).json()
    assert me["premium"] and me["subscription"] == {"plan": "yearly", "status": "ACTIVE"}

    # Résiliation : l'accès reste ouvert jusqu'à la fin de la période payée
    me = c.post("/api/billing/cancel", headers=headers).json()
    assert me["premium"] and me["subscription"]["status"] == "CANCELLED"

    # Paiement refusé (webhook) : accès coupé
    paypal["I-1"]["status"] = "SUSPENDED"
    event = {"event_type": "BILLING.SUBSCRIPTION.SUSPENDED", "resource": {"id": "I-1"}}
    assert c.post("/api/billing/paypal/webhook", json=event).status_code == 200
    assert c.get("/api/auth/me", headers=headers).json()["premium"] is False


def test_subscription_of_another_account_is_refused(env, paypal):
    c = env["client"]
    headers = signup(env)
    paypal["I-2"] = {"id": "I-2", "plan_id": "P-MONTH", "status": "ACTIVE", "custom_id": "autre-compte"}
    r = c.post("/api/billing/paypal/subscription", json={"subscription_id": "I-2"}, headers=headers)
    assert r.status_code == 400
    assert c.get("/api/auth/me", headers=headers).json()["premium"] is False


def test_webhook_with_bad_signature_is_rejected(env, paypal, monkeypatch):
    async def refuse(method, path, json=None):
        return {"verification_status": "FAILURE"}
    monkeypatch.setattr(billing, "paypal", refuse)
    r = env["client"].post("/api/billing/paypal/webhook", json={"event_type": "BILLING.SUBSCRIPTION.ACTIVATED"})
    assert r.status_code == 400


def test_baseline_failure_is_not_shown_as_checked(env):
    c = env["client"]
    headers = signup(env)
    make_premium(env)
    env["breaches"]["alice@example.com"] = RuntimeError("XON indisponible")
    m = c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers).json()
    assert m["verified"] and m["last_checked"] is None
    # La référence est établie au passage suivant, sans alerte sur les fuites déjà existantes
    env["breaches"]["alice@example.com"] = [breach("Ancienne")]
    env["sent"].clear()
    assert c.portal.call(premium.run_monitor_checks) == 0 and env["sent"] == []
    monitors = c.get("/api/premium/monitors", headers=headers).json()["monitors"]
    assert monitors[0]["total_breaches"] == 1 and monitors[0]["last_checked"]
