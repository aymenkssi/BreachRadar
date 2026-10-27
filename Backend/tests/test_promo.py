from datetime import timedelta

import pytest
import stripe

import billing
import promo
from test_admin import admin_headers, stripe_env, stripe_sub  # noqa: F401  (fixtures)
from test_premium import env, paypal, payment_config, signup, user_id  # noqa: F401  (fixtures)


def create(c, headers, **body):
    r = c.post("/api/admin/promos", json={"kind": "percent", "value": 20, "duration": "once", **body}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_admin_creates_and_lists_codes(env, admin_headers):  # noqa: F811
    c = env["client"]
    p = create(c, admin_headers, code="bienvenue 20")
    assert p["code"] == "BIENVENUE20" and p["description"] == "-20 % sur la première échéance"
    generated = create(c, admin_headers, kind="free", days=30)
    assert generated["code"].startswith("BR-") and generated["description"] == "30 jours de Premium offerts"
    assert c.post("/api/admin/promos", json={"code": "BIENVENUE20", "kind": "percent", "value": 10},
                  headers=admin_headers).status_code == 409
    assert c.post("/api/admin/promos", json={"kind": "percent", "value": 100},
                  headers=admin_headers).status_code == 422
    assert len(c.get("/api/admin/promos", headers=admin_headers).json()) == 2
    user = signup(env)
    assert c.get("/api/admin/promos", headers=user).status_code == 403


def test_check_code_computes_price(env, admin_headers, monkeypatch):  # noqa: F811
    async def get_config():
        return payment_config()
    monkeypatch.setattr(billing, "get_config", get_config)
    c = env["client"]
    create(c, admin_headers, code="MOINS20")
    create(c, admin_headers, code="TOUJOURS", kind="amount", value=1, duration="forever")
    create(c, admin_headers, code="ANNUEL", plans=["yearly"])
    user = signup(env)
    r = c.post("/api/billing/promo/check", json={"code": "moins20", "plan": "monthly"}, headers=user).json()
    assert r["price_before"] == "4,99 €" and r["price_after"] == "3,99 €"
    assert r["stripe"] is True and r["paypal"] is False  # PayPal : réduction sur toute la durée seulement
    r = c.post("/api/billing/promo/check", json={"code": "TOUJOURS", "plan": "yearly"}, headers=user).json()
    assert r["price_after"] == "48,99 €" and r["paypal"] is True
    r = c.post("/api/billing/promo/check", json={"code": "ANNUEL", "plan": "monthly"}, headers=user)
    assert r.status_code == 400 and "formule mensuelle" in r.json()["detail"]
    assert c.post("/api/billing/promo/check", json={"code": "INCONNU"}, headers=user).status_code == 400


def test_expired_disabled_and_exhausted_codes(env, admin_headers):  # noqa: F811
    c, db = env["client"], env["db"]
    p = create(c, admin_headers, code="LIMITE", kind="free", days=7, max_redemptions=1)
    first, second = signup(env), signup(env, "bob@example.com")
    assert c.post("/api/billing/promo/redeem", json={"code": "LIMITE"}, headers=first).status_code == 200
    r = c.post("/api/billing/promo/redeem", json={"code": "LIMITE"}, headers=second)
    assert r.status_code == 400 and "plus disponible" in r.json()["detail"]
    create(c, admin_headers, code="FINI", kind="free", days=7, expires_at="2099-01-01")
    c.portal.call(db.promo_codes.update_one, {"code": "FINI"},
                  {"$set": {"expires_at": (promo.now() - timedelta(days=1)).isoformat()}})
    assert "expiré" in c.post("/api/billing/promo/redeem", json={"code": "FINI"}, headers=second).json()["detail"]
    off = create(c, admin_headers, code="COUPE", kind="free", days=7)
    c.patch(f"/api/admin/promos/{off['id']}", json={"active": False}, headers=admin_headers)
    assert c.post("/api/billing/promo/redeem", json={"code": "COUPE"}, headers=second).status_code == 400
    assert [r["email"] for r in c.get(f"/api/admin/promos/{p['id']}/redemptions", headers=admin_headers).json()] \
        == ["alice@example.com"]


def test_free_code_grants_premium_once(env, admin_headers):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="OFFERT30", kind="free", days=30)
    user = signup(env)
    me = c.post("/api/billing/promo/redeem", json={"code": "OFFERT30"}, headers=user).json()
    assert me["premium"] and me["premium_until"][:10] == (promo.now() + timedelta(days=30)).date().isoformat()
    again = c.post("/api/billing/promo/redeem", json={"code": "OFFERT30"}, headers=user)
    assert again.status_code == 400 and "déjà utilisé" in again.json()["detail"]


def test_stripe_checkout_applies_coupon(env, admin_headers, stripe_env, monkeypatch):  # noqa: F811
    c = env["client"]
    created = []

    async def fake_call(fn, *args, **kwargs):
        if fn == stripe.Coupon.create:
            created.append(kwargs)
            return {"id": f"coupon_{len(created)}"}
        return await original(fn, *args, **kwargs)
    original = billing.stripe_call
    monkeypatch.setattr(billing, "stripe_call", fake_call)
    create(c, admin_headers, code="TROISMOIS", value=50, duration="repeating", duration_months=3)
    user = signup(env)
    for _ in range(2):
        c.post("/api/billing/stripe/checkout", json={"plan": "monthly", "promo_code": "troismois"}, headers=user)
    assert len(created) == 1  # coupon créé une seule fois puis réutilisé
    assert created[0]["percent_off"] == 50 and created[0]["duration_in_months"] == 3
    checkout = stripe_env["last_checkout"]
    assert checkout["discounts"] == [{"coupon": "coupon_1"}] and checkout["metadata"] == {"promo_code": "TROISMOIS"}

    uid = user_id(env)
    stripe_env["subs"]["sub_1"] = stripe_sub("sub_1", uid)
    stripe_env["sessions"]["cs_1"] = {"client_reference_id": uid, "subscription": stripe_env["subs"]["sub_1"],
                                      "metadata": {"promo_code": "TROISMOIS"}}
    assert c.post("/api/billing/stripe/confirm", json={"session_id": "cs_1"}, headers=user).json()["premium"]
    codes = c.get("/api/admin/promos", headers=admin_headers).json()
    assert codes[0]["redemptions"] == 1
    again = c.post("/api/billing/stripe/checkout", json={"plan": "monthly", "promo_code": "TROISMOIS"}, headers=user)
    assert again.status_code == 400


def test_paypal_discount_is_set_by_server(env, admin_headers, paypal):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="FIDELE", kind="amount", value=10, duration="forever")
    create(c, admin_headers, code="PREMIERMOIS", value=50)
    user = signup(env)
    r = c.post("/api/billing/paypal/create", json={"plan": "yearly", "promo_code": "PREMIERMOIS"}, headers=user)
    assert r.status_code == 400 and "carte" in r.json()["detail"]
    sub_id = c.post("/api/billing/paypal/create", json={"plan": "yearly", "promo_code": "FIDELE"},
                    headers=user).json()["id"]
    price = paypal[sub_id]["request"]["plan"]["billing_cycles"][0]["pricing_scheme"]["fixed_price"]
    assert price == {"value": "39.99", "currency_code": "EUR"}
    paypal[sub_id]["status"] = "ACTIVE"
    me = c.post("/api/billing/paypal/subscription", json={"subscription_id": sub_id}, headers=user).json()
    assert me["premium"]
    assert c.get("/api/admin/promos", headers=admin_headers).json()[1]["redemptions"] == 1


@pytest.mark.parametrize("label,expected", [("4,99 €", "4.99"), ("49 €", "49"), ("", None)])
def test_parse_price(label, expected):
    assert (str(promo.parse_price(label)) if promo.parse_price(label) is not None else None) == expected
