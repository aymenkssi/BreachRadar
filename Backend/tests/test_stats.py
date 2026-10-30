from datetime import timedelta

import stats
from test_premium import env  # noqa: F401  (fixture)

CATALOG = {"exposedBreaches": [
    {"breachID": "Alpha", "exposedRecords": 1_000_000, "exposedData": ["Email addresses", "Passwords"]},
    {"breachID": "Beta", "exposedRecords": 250_000, "exposedData": ["Email addresses", "Names"]},
    {"breachID": "Gamma", "exposedRecords": 50_000, "exposedData": ["Credit cards", "Email addresses"]},
    {"breachID": "Delta", "exposedRecords": 3_000, "exposedData": ["Usernames"]},
]}


def test_stats_from_catalog_with_trends(env, monkeypatch):  # noqa: F811
    c, db = env["client"], env["db"]
    monkeypatch.setattr(stats, "_get", lambda url, params, strict: CATALOG)
    old = (stats.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    c.portal.call(db.stats_history.insert_one, {"date": old, "breaches": 3, "records": 1_200_000,
                                                "monitored_addresses": 0})
    data = c.get("/api/stats").json()
    assert (data["breaches"], data["records"]) == (4, 1_303_000)
    assert data["critical_breaches"] == 2 and data["password_breaches"] == 1
    assert data["source_ok"] is True and data["available"] is True
    assert data["trends"]["breaches"] == {"pct": 33.3, "days": 30}
    assert data["trends"]["records"] == {"pct": 8.6, "days": 30}
    assert data["trends"]["monitored_addresses"] is None  # pas de base de comparaison
    assert c.portal.call(db.stats_history.count_documents, {}) == 2  # relevé du jour enregistré


def test_stats_cached_and_source_outage(env, monkeypatch):  # noqa: F811
    c = env["client"]
    calls = []

    def fake_get(url, params, strict):
        calls.append(url)
        return CATALOG
    monkeypatch.setattr(stats, "_get", fake_get)
    first = c.get("/api/stats").json()
    c.get("/api/stats")
    assert len(calls) == 1  # mis en cache une heure
    assert first["trends"]["breaches"] is None  # historique trop court

    def down(url, params, strict):
        raise RuntimeError("XON indisponible")
    monkeypatch.setattr(stats, "_get", down)
    data = c.portal.call(stats.refresh)
    assert data["source_ok"] is False and data["breaches"] == 4  # derniers chiffres connus conservés


def test_stats_unavailable_without_any_data(env, monkeypatch):  # noqa: F811
    def down(url, params, strict):
        raise RuntimeError("XON indisponible")
    monkeypatch.setattr(stats, "_get", down)
    assert env["client"].get("/api/stats").json() == {"available": False, "source_ok": False}
