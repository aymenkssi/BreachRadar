# Indicateurs publics de la page d'accueil : volume des fuites recensées par XposedOrNot (catalogue
# public), part des fuites critiques et nombre d'adresses sous veille BreachRadar. Les tendances
# comparent au relevé d'il y a 30 jours (un relevé par jour dans stats_history).
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter

import settings_store
from server import XON_BASE, _get, db, parse_domain

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["stats"])

CACHE_SECONDS = 3600
DISPLAY_KEY = "stats_display"
MONITORED_DEFAULTS = {"mode": "auto", "value": 0, "label": "Adresses surveillées", "sub": "veille BreachRadar Premium"}
TREND_DAYS = 30
MIN_TREND_DAYS = 7  # en dessous, l'historique est trop court pour afficher une tendance
_lock = asyncio.Lock()


def now() -> datetime:
    return datetime.now(timezone.utc)


async def _monitored_addresses() -> int:
    return await db.monitors.count_documents({"verified": True})


def summarize(catalog: dict) -> dict:
    breaches = parse_domain(catalog or {})
    return {
        "breaches": len(breaches),
        "records": sum(b.exposed_records for b in breaches),
        "critical_breaches": sum(1 for b in breaches if b.severity == "critical"),
        "password_breaches": sum(1 for b in breaches if any("password" in d.lower() for d in b.exposed_data)),
    }


async def _trend(field: str, current: int, today: str) -> Optional[dict]:
    """Évolution par rapport au relevé d'il y a TREND_DAYS jours (ou au plus ancien, s'il a au moins 7 jours)."""
    target = (now() - timedelta(days=TREND_DAYS)).strftime("%Y-%m-%d")
    past = await db.stats_history.find_one({"date": {"$lte": target}}, {"_id": 0}, sort=[("date", -1)])
    if not past:
        past = await db.stats_history.find_one({"date": {"$lt": today}}, {"_id": 0}, sort=[("date", 1)])
    if not past or not past.get(field):
        return None
    days = (datetime.fromisoformat(today) - datetime.fromisoformat(past["date"])).days
    if days < MIN_TREND_DAYS:
        return None
    return {"pct": round((current - past[field]) / past[field] * 100, 1), "days": days}


async def refresh() -> dict:
    """Recalcule les indicateurs (catalogue XposedOrNot) et enregistre le relevé du jour."""
    today = now().strftime("%Y-%m-%d")
    try:
        catalog = await asyncio.to_thread(_get, f"{XON_BASE}/breaches", None, True)
        figures = summarize(catalog)
        source_ok = figures["breaches"] > 0
    except Exception as e:
        logger.warning(f"Indicateurs : catalogue XposedOrNot indisponible ({e})")
        source_ok = False
    previous = await db.stats_cache.find_one({"_id": "global"}, {"_id": 0}) or {}
    if not source_ok:
        if not previous:
            return {"available": False, "source_ok": False}
        figures = {k: previous[k] for k in ("breaches", "records", "critical_breaches", "password_breaches")}
    figures["monitored_addresses"] = await _monitored_addresses()
    if source_ok:
        await db.stats_history.update_one({"date": today}, {"$set": {"date": today, **figures}}, upsert=True)
    trends = {k: await _trend(k, figures[k], today) for k in ("breaches", "records", "monitored_addresses")}
    result = {**figures, "trends": trends, "source_ok": source_ok, "available": True,
              "computed_at": now().isoformat(),
              "data_updated_at": now().isoformat() if source_ok else previous.get("data_updated_at")}
    await db.stats_cache.update_one({"_id": "global"}, {"$set": result}, upsert=True)
    return result


async def monitored_display() -> dict:
    """Réglage de la carte « Adresses surveillées » (admin) : auto (compteur réel), manual ou hidden."""
    doc = await settings_store.get(DISPLAY_KEY) or {}
    return {k: doc.get(f"monitored_{k}", v) for k, v in MONITORED_DEFAULTS.items()}


def apply_display(data: dict, display: dict) -> dict:
    if not data.get("available"):
        return data
    data = {**data, "trends": dict(data.get("trends") or {}),
            "monitored_card": {"label": display["label"], "sub": display["sub"], "hidden": display["mode"] == "hidden"}}
    if display["mode"] == "manual":
        data["monitored_addresses"] = display["value"]
        data["trends"]["monitored_addresses"] = None  # pas de tendance sur une valeur saisie
    return data


async def _current() -> dict:
    cached = await db.stats_cache.find_one({"_id": "global"}, {"_id": 0})
    if cached and (now() - datetime.fromisoformat(cached["computed_at"])).total_seconds() < CACHE_SECONDS:
        return cached
    async with _lock:  # un seul recalcul à la fois par processus
        cached = await db.stats_cache.find_one({"_id": "global"}, {"_id": 0})
        if cached and (now() - datetime.fromisoformat(cached["computed_at"])).total_seconds() < CACHE_SECONDS:
            return cached
        return await refresh()


@router.get("/stats")
async def stats():
    return apply_display(await _current(), await monitored_display())
