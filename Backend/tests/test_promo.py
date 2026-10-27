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
    assert generated["code"].startswith("BR-")
    assert generated["description"] == "30 jours gratuits, puis abonnement au tarif normal"
    assert c.post("/api/admin/promos", json={"code": "BIENVENUE20", "kind": "percent", "value": 10},
                  headers=admin_headers).status_code == 409
    assert c.post("/api/admin/promos", json={"kind": "percent", "value": 100, "duration": "forever"},
                  headers=admin_headers).status_code == 422
    assert create(c, admin_headers, code="MOISOFFERT", value=100)["description"] == "-100 % sur la première échéance"
    assert len(c.get("/api/admin/promos", headers=admin_headers).json()) == 3
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
    assert r["stripe"] is True and r["paypal"] is True  # PayPal : période d'essai au prix réduit
    r = c.post("/api/billing/promo/check", json={"code": "TOUJOURS", "plan": "yearly"}, headers=user).json()
    assert r["price_after"] == "48,99 €" and r["paypal"] is True
    r = c.post("/api/billing/promo/check", json={"code": "ANNUEL", "plan": "monthly"}, headers=user)
    assert r.status_code == 400 and "formule mensuelle" in r.json()["detail"]
    assert c.post("/api/billing/promo/check", json={"code": "INCONNU"}, headers=user).status_code == 400


def test_expired_disabled_and_exhausted_codes(env, admin_headers, monkeypatch):  # noqa: F811
    async def get_config():
        return payment_config()
    monkeypatch.setattr(billing, "get_config", get_config)
    c, db = env["client"], env["db"]
    p = create(c, admin_headers, code="LIMITE", max_redemptions=1)
    first, second = signup(env), signup(env, "bob@example.com")

    def check(code, headers):
        return c.post("/api/billing/promo/check", json={"code": code}, headers=headers)
    assert check("LIMITE", first).status_code == 200
    promo_doc = c.portal.call(db.promo_codes.find_one, {"code": "LIMITE"})
    c.portal.call(promo.record_redemption, promo_doc, {"id": user_id(env), "email": "alice@example.com"}, "stripe")
    assert check("LIMITE", first).status_code == 400
    assert "plus disponible" in check("LIMITE", second).json()["detail"]
    create(c, admin_headers, code="FINI", expires_at="2099-01-01")
    c.portal.call(db.promo_codes.update_one, {"code": "FINI"},
                  {"$set": {"expires_at": (promo.now() - timedelta(days=1)).isoformat()}})
    assert "expiré" in check("FINI", second).json()["detail"]
    off = create(c, admin_headers, code="COUPE")
    c.patch(f"/api/admin/promos/{off['id']}", json={"active": False}, headers=admin_headers)
    assert check("COUPE", second).status_code == 400
    assert [r["email"] for r in c.get(f"/api/admin/promos/{p['id']}/redemptions", headers=admin_headers).json()] \
        == ["alice@example.com"]


def test_free_trial_with_stripe_then_cancel(env, admin_headers, stripe_env):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="ESSAI7", kind="free", days=7)
    user = signup(env)
    r = c.post("/api/billing/promo/check", json={"code": "essai7", "plan": "monthly"}, headers=user).json()
    assert r["description"] == "7 jours gratuits, puis 4,99 € par mois" and r["trial_days"] == 7
    assert r["stripe"] and r["paypal"]
    # Checkout : moyen de paiement enregistré, essai de 7 jours, aucune réduction
    c.post("/api/billing/stripe/checkout", json={"plan": "monthly", "promo_code": "ESSAI7"}, headers=user)
    checkout = stripe_env["last_checkout"]
    assert checkout["subscription_data"]["trial_period_days"] == 7 and "discounts" not in checkout

    uid = user_id(env)
    trial_end = int((promo.now() + timedelta(days=7)).timestamp())
    sub = stripe_sub("sub_t", uid, status="trialing", end=trial_end)
    sub["trial_end"] = trial_end
    stripe_env["subs"]["sub_t"] = sub
    stripe_env["sessions"]["cs_t"] = {"client_reference_id": uid, "subscription": sub,
                                      "metadata": {"promo_code": "ESSAI7"}}
    me = c.post("/api/billing/stripe/confirm", json={"session_id": "cs_t"}, headers=user).json()
    assert me["premium"] and me["subscription"]["status"] == "ACTIVE"
    assert me["subscription"]["trial_end"][:10] == (promo.now() + timedelta(days=7)).date().isoformat()

    # Résiliation pendant l'essai : aucun prélèvement, accès jusqu'à la fin de l'essai
    me = c.post("/api/billing/cancel", headers=user).json()
    assert me["premium"] and me["subscription"]["status"] == "CANCELLED"
    assert stripe_env["subs"]["sub_t"]["cancel_at_period_end"] is True


def test_free_trial_with_paypal(env, admin_headers, paypal):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="ESSAI7", kind="free", days=7)
    user = signup(env)
    sub, plan = paypal_checkout(c, paypal, user, "yearly", "ESSAI7")
    trial, regular = plan["billing_cycles"]
    assert trial == {"frequency": {"interval_unit": "DAY", "interval_count": 7}, "tenure_type": "TRIAL",
                     "sequence": 1, "total_cycles": 1}
    assert regular["frequency"]["interval_unit"] == "YEAR"
    assert regular["pricing_scheme"]["fixed_price"]["value"] == "49.99"
    end = (promo.now() + timedelta(days=7)).replace(microsecond=0)
    sub.update(status="ACTIVE", billing_info={
        "next_billing_time": end.isoformat().replace("+00:00", "Z"),
        "cycle_executions": [{"tenure_type": "TRIAL", "cycles_completed": 0, "cycles_remaining": 1},
                             {"tenure_type": "REGULAR", "cycles_completed": 0, "cycles_remaining": 0}]})
    me = c.post("/api/billing/paypal/subscription", json={"subscription_id": sub["id"]}, headers=user).json()
    assert me["premium"] and me["subscription"]["plan"] == "yearly"
    assert me["subscription"]["trial_end"][:10] == end.date().isoformat()
    me = c.post("/api/billing/cancel", headers=user).json()
    assert me["premium"] and me["subscription"]["status"] == "CANCELLED"


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


def paypal_checkout(c, paypal, headers, plan, code):  # noqa: F811
    r = c.post("/api/billing/paypal/create", json={"plan": plan, "promo_code": code}, headers=headers)
    assert r.status_code == 200, r.text
    sub = paypal[r.json()["id"]]
    return sub, paypal["_plans"].get(sub["plan_id"])


def test_paypal_promo_plans_with_trial(env, admin_headers, paypal):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="FIDELE", kind="amount", value=10, duration="forever")
    create(c, admin_headers, code="PREMIERMOIS", value=50)
    create(c, admin_headers, code="TROISMOIS", value=20, duration="repeating", duration_months=3)
    create(c, admin_headers, code="GRATUIT", value=100)
    user = signup(env)

    # 1re échéance à -50 % : essai d'1 mois à 2,50 €, puis 4,99 €/mois
    sub, plan = paypal_checkout(c, paypal, user, "monthly", "PREMIERMOIS")
    trial, regular = plan["billing_cycles"]
    assert (trial["tenure_type"], trial["total_cycles"], trial["pricing_scheme"]["fixed_price"]["value"]) == \
        ("TRIAL", 1, "2.50")
    assert (regular["tenure_type"], regular["pricing_scheme"]["fixed_price"]["value"]) == ("REGULAR", "4.99")
    assert plan["product_id"] == "PROD-1" and "plan" not in sub["request"]

    # -20 % pendant 3 mois : 3 échéances mensuelles à 3,99 € ; en annuel, la 1re année
    _, plan = paypal_checkout(c, paypal, user, "monthly", "TROISMOIS")
    assert plan["billing_cycles"][0]["total_cycles"] == 3
    assert plan["billing_cycles"][0]["pricing_scheme"]["fixed_price"]["value"] == "3.99"
    _, plan = paypal_checkout(c, paypal, user, "yearly", "TROISMOIS")
    assert plan["billing_cycles"][0]["total_cycles"] == 1
    assert plan["billing_cycles"][0]["frequency"]["interval_unit"] == "YEAR"

    # 100 % sur la 1re échéance : premier mois gratuit (essai sans prix)
    _, plan = paypal_checkout(c, paypal, user, "monthly", "GRATUIT")
    assert "pricing_scheme" not in plan["billing_cycles"][0]

    # Toute la durée : un seul cycle au tarif réduit
    sub, plan = paypal_checkout(c, paypal, user, "yearly", "FIDELE")
    assert len(plan["billing_cycles"]) == 1
    assert plan["billing_cycles"][0]["pricing_scheme"]["fixed_price"]["value"] == "39.99"

    # Le plan d'un code est réutilisé pour les clients suivants
    created = len(paypal["_plans"])
    paypal_checkout(c, paypal, signup(env, "bob@example.com"), "yearly", "FIDELE")
    assert len(paypal["_plans"]) == created

    # Activation : le plan du code est reconnu comme formule annuelle, l'utilisation est comptée
    sub["status"] = "ACTIVE"
    me = c.post("/api/billing/paypal/subscription", json={"subscription_id": sub["id"]}, headers=user).json()
    assert me["premium"] and me["subscription"]["plan"] == "yearly"
    fidele = next(p for p in c.get("/api/admin/promos", headers=admin_headers).json() if p["code"] == "FIDELE")
    assert fidele["redemptions"] == 1

    # Renouvellement signalé par webhook : Premium prolongé malgré le plan propre au code
    sub["billing_info"]["next_billing_time"] = "2100-06-01T00:00:00Z"
    event = {"event_type": "PAYMENT.SALE.COMPLETED", "resource": {"billing_agreement_id": sub["id"]}}
    assert c.post("/api/billing/paypal/webhook", json=event).status_code == 200
    assert c.get("/api/auth/me", headers=user).json()["premium_until"].startswith("2100-06-02")


@pytest.mark.parametrize("label,expected", [("4,99 €", "4.99"), ("49 €", "49"), ("", None)])
def test_parse_price(label, expected):
    assert (str(promo.parse_price(label)) if promo.parse_price(label) is not None else None) == expected


def test_big_discount_messages_depend_on_payment_methods(env, admin_headers, monkeypatch):  # noqa: F811
    c = env["client"]
    create(c, admin_headers, code="QUASI", value=95)                        # 1re échéance : carte seulement
    create(c, admin_headers, code="QUASITOUJOURS", value=95, duration="forever")
    user = signup(env)
    cfg = {"value": payment_config(stripe_enabled=False)}               # seul PayPal est proposé

    async def get_config():
        return cfg["value"]
    monkeypatch.setattr(billing, "get_config", get_config)
    r = c.post("/api/billing/promo/check", json={"code": "QUASI", "plan": "monthly"}, headers=user).json()
    assert r["paypal"] is True and r["price_after"] == "0,25 €"  # période d'essai PayPal à 0,25 €
    r = c.post("/api/billing/promo/check", json={"code": "QUASITOUJOURS", "plan": "monthly"}, headers=user)
    assert r.status_code == 400 and "0,50 €" in r.json()["detail"]
    cfg["value"] = payment_config()                                      # Stripe ajouté : la carte accepte
    r = c.post("/api/billing/promo/check", json={"code": "QUASI", "plan": "monthly"}, headers=user).json()
    assert r["price_after"] == "0,25 €" and r["stripe"] and r["paypal"]
