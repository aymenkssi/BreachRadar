from datetime import timedelta
from types import SimpleNamespace

import pytest

import billing
import mailer
import privacy
import stripe
from test_premium import env, make_premium, payment_config, signup, user_id  # noqa: F401  (fixture)


@pytest.fixture
def admin_headers(env, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    return signup(env, "admin@example.com")


# ---------- Accès et abonnés ----------
def test_admin_routes_require_admin(env, admin_headers):  # noqa: F811
    c = env["client"]
    user = signup(env)
    assert c.get("/api/admin/overview", headers=user).status_code == 403
    assert c.get("/api/admin/overview").status_code == 401
    assert c.get("/api/auth/me", headers=admin_headers).json()["is_admin"] is True
    overview = c.get("/api/admin/overview", headers=admin_headers).json()
    assert overview["users"] == 2 and overview["premium"] == 0


def test_grant_and_revoke_premium(env, admin_headers):  # noqa: F811
    c = env["client"]
    user = signup(env)
    uid = user_id(env)
    r = c.post(f"/api/admin/users/{uid}/premium", json={"until": "2099-12-31", "note": "geste"}, headers=admin_headers)
    assert r.json()["premium"] and r.json()["manual_premium"]["by"] == "admin@example.com"
    assert c.get("/api/auth/me", headers=user).json()["premium"] is True
    listed = c.get("/api/admin/users", params={"status": "premium"}, headers=admin_headers).json()
    assert [u["email"] for u in listed["users"]] == ["alice@example.com"]
    c.post(f"/api/admin/users/{uid}/revoke", headers=admin_headers)
    assert c.get("/api/auth/me", headers=user).json()["premium"] is False
    actions = [a["action"] for a in c.get("/api/admin/audit", headers=admin_headers).json()]
    assert actions[:2] == ["PREMIUM_REVOKE", "PREMIUM_GRANT"]


def test_admin_cannot_grant_in_the_past(env, admin_headers):  # noqa: F811
    signup(env)
    r = env["client"].post(f"/api/admin/users/{user_id(env)}/premium", json={"until": "2000-01-01"},
                           headers=admin_headers)
    assert r.status_code == 400


# ---------- Moyens de paiement ----------
def payments_body(**over):
    body = dict(price_monthly_label="5 €", price_yearly_label="50 €", paypal_enabled=False, paypal_mode="sandbox",
                paypal_client_id="", paypal_webhook_id="", paypal_plan_monthly="", paypal_plan_yearly="",
                stripe_enabled=True, stripe_secret_key="sk_test_SECRET123", stripe_webhook_secret="whsec_SECRET",
                stripe_price_monthly="price_m", stripe_price_yearly="price_y")
    return {**body, **over}


def test_payment_settings_store_secrets_encrypted(env, admin_headers):  # noqa: F811
    c = env["client"]
    out = c.put("/api/admin/payments", json=payments_body(), headers=admin_headers).json()
    assert out["stripe_ready"] and out["stripe_secret_key_set"] and out["stripe_secret_key_mode"] == "test"
    assert "SECRET123" not in str(out)
    doc = c.portal.call(env["db"].platform_settings.find_one, {"key": "payments"})
    assert "SECRET123" not in str(doc) and doc["stripe_secret_key_encrypted"]
    cfg = c.portal.call(billing.get_config)
    assert cfg.stripe_secret_key == "sk_test_SECRET123"
    # Sans nouvelle valeur, le secret enregistré est conservé
    c.put("/api/admin/payments", json=payments_body(stripe_secret_key=None), headers=admin_headers)
    assert c.portal.call(billing.get_config).stripe_secret_key == "sk_test_SECRET123"
    conf = c.get("/api/billing/config").json()
    assert conf["stripe"]["enabled"] and not conf["paypal"]["enabled"] and conf["plans"][0]["price"] == "5 €"
    audit = c.get("/api/admin/audit", headers=admin_headers).json()
    assert "SECRET" not in str(audit)


def test_create_stripe_prices_from_admin(env, admin_headers, monkeypatch):  # noqa: F811
    c = env["client"]
    c.put("/api/admin/payments", json=payments_body(stripe_price_monthly="", stripe_price_yearly=""),
          headers=admin_headers)
    created = {}
    monkeypatch.setattr(stripe.Product, "create", lambda **kw: SimpleNamespace(id="prod_1"))

    def price(**kw):
        created[kw["recurring"]["interval"]] = kw["unit_amount"]
        return SimpleNamespace(id=f"price_{kw['recurring']['interval']}")
    monkeypatch.setattr(stripe.Price, "create", price)
    out = c.post("/api/admin/payments/create-plans", json={"provider": "stripe", "monthly": "4,99", "yearly": "49.99"},
                 headers=admin_headers).json()
    assert created == {"month": 499, "year": 4999}
    assert out["stripe_price_monthly"] == "price_month" and out["price_monthly_label"] == "4,99 €"


# ---------- Stripe ----------
@pytest.fixture
def stripe_env(env, monkeypatch):  # noqa: F811
    async def get_config():
        return payment_config()
    monkeypatch.setattr(billing, "get_config", get_config)
    store = {"subs": {}, "sessions": {}}

    async def fake_call(fn, *args, **kwargs):
        if fn == stripe.checkout.Session.create:
            store["last_checkout"] = kwargs
            return {"url": "https://checkout.stripe.com/c/test"}
        if fn == stripe.checkout.Session.retrieve:
            return store["sessions"][args[0]]
        if fn == stripe.Subscription.retrieve:
            return store["subs"][args[0]]
        if fn == stripe.Subscription.modify:
            store["subs"][args[0]]["cancel_at_period_end"] = kwargs["cancel_at_period_end"]
            return store["subs"][args[0]]
        raise AssertionError(fn)
    monkeypatch.setattr(billing, "stripe_call", fake_call)
    return store


def stripe_sub(sub_id, uid, status="active", price="price_m", end=4102444800):
    return {"id": sub_id, "status": status, "customer": "cus_1", "metadata": {"user_id": uid},
            "cancel_at_period_end": False,
            "items": {"data": [{"price": {"id": price}, "current_period_end": end}]}}


def test_stripe_checkout_confirm_cancel_and_webhook(env, stripe_env, monkeypatch):  # noqa: F811
    c = env["client"]
    headers = signup(env)
    uid = user_id(env)
    r = c.post("/api/billing/stripe/checkout", json={"plan": "yearly"}, headers=headers).json()
    assert r["url"].startswith("https://checkout.stripe.com")
    assert stripe_env["last_checkout"]["client_reference_id"] == uid
    assert stripe_env["last_checkout"]["line_items"][0]["price"] == "price_y"

    stripe_env["subs"]["sub_1"] = stripe_sub("sub_1", uid, price="price_y")
    stripe_env["sessions"]["cs_1"] = {"client_reference_id": uid, "subscription": stripe_env["subs"]["sub_1"]}
    stripe_env["sessions"]["cs_other"] = {"client_reference_id": "autre", "subscription": stripe_env["subs"]["sub_1"]}
    assert c.post("/api/billing/stripe/confirm", json={"session_id": "cs_other"}, headers=headers).status_code == 400
    me = c.post("/api/billing/stripe/confirm", json={"session_id": "cs_1"}, headers=headers).json()
    assert me["premium"] and me["subscription"] == {"provider": "stripe", "plan": "yearly", "status": "ACTIVE"}
    assert me["premium_until"].startswith("2100-01-02")

    me = c.post("/api/billing/cancel", headers=headers).json()
    assert me["premium"] and me["subscription"]["status"] == "CANCELLED"

    # Webhook : paiement en échec -> accès coupé
    stripe_env["subs"]["sub_1"].update(status="past_due", cancel_at_period_end=False)
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda payload, sig, secret: {
        "type": "invoice.payment_failed",
        "data": {"object": {"parent": {"subscription_details": {"subscription": "sub_1"}}}}})
    assert c.post("/api/billing/stripe/webhook", content=b"{}", headers={"stripe-signature": "t=1"}).status_code == 200
    assert c.get("/api/auth/me", headers=headers).json()["premium"] is False


def test_stripe_webhook_rejects_bad_signature(env, stripe_env, monkeypatch):  # noqa: F811
    def boom(*a, **k):
        raise ValueError("bad signature")
    monkeypatch.setattr(stripe.Webhook, "construct_event", boom)
    assert env["client"].post("/api/billing/stripe/webhook", content=b"{}").status_code == 400


# ---------- E-mails : quota et bascule ----------
def smtp_body(**over):
    return {"host": "smtp-relay.brevo.com", "port": 587, "security": "starttls", "username": "u@brevo",
            "password": "MOTDEPASSE-SMTP", "from_address": "alertes@breachradar.fr", "sender_name": "BreachRadar",
            "daily_limit": 2, **over}


def test_smtp_settings_quota_and_fallback(env, admin_headers, monkeypatch):  # noqa: F811
    c, sent = env["client"], env["sent"]
    monkeypatch.setenv("SMTP_HOST", "smtp.secours.fr")  # le .env devient le service de secours
    out = c.put("/api/admin/smtp", json=smtp_body(), headers=admin_headers).json()
    assert out["source"] == "admin" and out["password_set"] and "MOTDEPASSE" not in str(out)
    assert out["fallback"]["configured"]
    sent.clear()
    c.portal.call(env["db"].email_stats.delete_many, {})  # oublie les codes envoyés à l'inscription
    for _ in range(3):
        assert c.portal.call(mailer.send, "x@example.com", "Sujet", "<p>x</p>", "x")
    froms = [m["From"] for m in sent]
    assert froms[:2] == ["BreachRadar <alertes@breachradar.fr>"] * 2 and "test@breachradar.fr" in froms[2]
    usage = c.get("/api/admin/smtp/usage", headers=admin_headers).json()
    assert usage["primary"]["sent"] == 2 and usage["fallback"]["sent"] == 1
    assert usage["limit_reached"] and usage["active"] == "fallback" and usage["history"][-1]["primary_sent"] == 2


def test_smtp_primary_failure_switches_to_fallback(env, admin_headers, monkeypatch):  # noqa: F811
    c, sent = env["client"], env["sent"]
    monkeypatch.setenv("SMTP_HOST", "smtp.secours.fr")
    c.put("/api/admin/smtp", json=smtp_body(daily_limit=100), headers=admin_headers)

    def transport(msg):
        if "alertes@" in msg["From"]:
            raise RuntimeError("550 daily quota exceeded")
        sent.append(msg)
    monkeypatch.setattr(mailer, "_transport", transport)
    assert c.portal.call(mailer.send, "x@example.com", "Sujet", "<p>x</p>", "x")
    usage = c.get("/api/admin/smtp/usage", headers=admin_headers).json()
    assert usage["primary"]["failed"] == 1 and usage["provider_quota_hit"] and usage["fallback"]["sent"] == 1


def test_smtp_test_email(env, admin_headers):  # noqa: F811
    c = env["client"]
    c.put("/api/admin/smtp", json=smtp_body(), headers=admin_headers)
    r = c.post("/api/admin/smtp/test", json={}, headers=admin_headers)
    assert r.json() == {"sent_to": "admin@example.com", "service": "primary"}
    assert env["sent"][-1]["Subject"] == "E-mail de test - BreachRadar"


# ---------- Pages légales et RGPD ----------
def test_legal_info_is_public(env, admin_headers):  # noqa: F811
    c = env["client"]
    c.put("/api/admin/legal", json={"company_name": "Exemple SAS", "siret": "123"}, headers=admin_headers)
    legal = c.get("/api/legal").json()
    assert legal["company_name"] == "Exemple SAS" and legal["prices"]["monthly"]


def test_registration_requires_terms(env):  # noqa: F811
    r = env["client"].post("/api/auth/register", json={"email": "z@example.com", "password": "motdepasse1"})
    assert r.status_code == 400


def test_export_and_delete_account(env):  # noqa: F811
    c = env["client"]
    headers = signup(env)
    make_premium(env)
    c.post("/api/premium/monitors", json={"email": "alice@example.com"}, headers=headers)
    data = c.get("/api/auth/export", headers=headers).json()
    assert data["account"]["email"] == "alice@example.com" and "password_hash" not in data["account"]
    assert len(data["monitors"]) == 1
    assert c.request("DELETE", "/api/auth/account", json={"password": "mauvais"}, headers=headers).status_code == 401
    r = c.request("DELETE", "/api/auth/account", json={"password": "motdepasse1"}, headers=headers)
    assert r.status_code == 200
    assert c.get("/api/auth/me", headers=headers).status_code == 401
    assert c.portal.call(env["db"].monitors.count_documents, {}) == 0


def test_purge_applies_retention(env):  # noqa: F811
    c, db = env["client"], env["db"]
    old = (privacy.now() - timedelta(days=400)).isoformat()
    c.portal.call(db.investigations.insert_many, [
        {"id": "a", "owner": "anon:1", "created_at": old},
        {"id": "b", "owner": "user:1", "created_at": old},
        {"id": "c", "owner": "anon:2", "created_at": privacy.now().isoformat()},
    ])
    c.portal.call(db.users.insert_many, [
        {"id": "u1", "email": "pending@example.com", "email_verified": False, "created_at": old},
        {"id": "u2", "email": "dormant@example.com", "email_verified": True, "created_at": old,
         "last_login_at": (privacy.now() - timedelta(days=4 * 365)).isoformat()},
        {"id": "u3", "email": "paid@example.com", "email_verified": True, "created_at": old,
         "last_login_at": (privacy.now() - timedelta(days=4 * 365)).isoformat(),
         "premium_until": "2099-01-01T00:00:00+00:00"},
    ])
    counts = c.portal.call(privacy.purge_expired_data)
    assert counts["anonymous_investigations"] == 1 and counts["unverified_accounts"] == 1
    assert counts["inactive_accounts"] == 1
    remaining = {u["email"] for u in c.portal.call(lambda: db.users.find({}).to_list(10))}
    assert remaining == {"paid@example.com"}
    assert {i["id"] for i in c.portal.call(lambda: db.investigations.find({}).to_list(10))} == {"b", "c"}


def test_yearly_renewal_reminder_sent_once(env):  # noqa: F811
    c, db = env["client"], env["db"]
    signup(env)
    until = (billing.now() + timedelta(days=45)).isoformat()
    c.portal.call(db.users.update_one, {"email": "alice@example.com"}, {"$set": {
        "premium_until": until, "subscription": {"provider": "stripe", "id": "sub_1", "plan": "yearly",
                                                 "status": "ACTIVE"}}})
    env["sent"].clear()
    assert c.portal.call(billing.send_renewal_reminders) == 1
    assert "renouvelé" in env["sent"][0]["Subject"]
    assert c.portal.call(billing.send_renewal_reminders) == 0


def test_create_admin_without_email_code(env, monkeypatch):  # noqa: F811
    import create_admin
    monkeypatch.setattr(create_admin, "db", env["db"])
    monkeypatch.setenv("ADMIN_EMAILS", "admin@breachradar.fr")
    c = env["client"]
    # Un compte non confirmé existant (inscription commencée) est réparé, sans e-mail
    c.post("/api/auth/register", json={"email": "admin@breachradar.fr", "password": "ancien123", "accept_terms": True})
    env["sent"].clear()
    c.portal.call(create_admin.create_admin, "Admin@BreachRadar.fr", "nouveau-mdp1")
    assert env["sent"] == []
    r = c.post("/api/auth/login", json={"email": "admin@breachradar.fr", "password": "nouveau-mdp1"})
    assert r.status_code == 200 and r.json()["user"]["is_admin"] is True
    assert c.portal.call(env["db"].users.count_documents, {"email": "admin@breachradar.fr"}) == 1
