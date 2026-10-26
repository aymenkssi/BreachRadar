from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import asyncio
import logging
import requests
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Any, Dict
import uuid
from datetime import datetime, timezone

import anthropic

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ANTHROPIC_MODEL = os.environ.get('ANTHROPIC_MODEL', 'claude-opus-5-5')
_llm_client = None


def get_llm_client() -> anthropic.AsyncAnthropic:
    # Instancié à la demande : l'API reste utilisable sans clé (rapport de repli).
    global _llm_client
    if _llm_client is None:
        _llm_client = anthropic.AsyncAnthropic()
    return _llm_client


app = FastAPI(title="BreachRadar AI")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

XON_BASE = "https://api.xposedornot.com/v1"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")

SENSITIVE_DATA = {
    "passwords", "credit card details", "credit cards", "social security numbers",
    "government issued ids", "government ids", "bank account numbers", "auth tokens",
    "partial credit card data", "security questions and answers", "private messages",
}


# ---------- Models ----------
class InvestigateRequest(BaseModel):
    target: str


class BatchRequest(BaseModel):
    targets: List[str]


class PasswordCheckRequest(BaseModel):
    password: str


class WatchCreate(BaseModel):
    target: str


class Watch(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    target: str
    target_type: str
    score: int = 0
    risk_label: str = "Clean"
    total_breaches: int = 0
    latest_breach: str = ""
    breach_names: List[str] = []
    new_breaches: List[str] = []
    has_new: bool = False
    last_checked: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Breach(BaseModel):
    name: str
    title: str
    domain: str = ""
    date: str = ""
    industry: str = ""
    logo: str = ""
    exposed_data: List[str] = []
    exposed_records: int = 0
    description: str = ""
    verified: bool = False
    password_risk: str = ""
    reference: str = ""
    severity: str = "medium"


class AiReport(BaseModel):
    threat_level: str = "Unknown"
    executive_summary: str = ""
    attack_vectors: List[str] = []
    data_exposure_analysis: str = ""
    recommendations: List[str] = []
    immediate_actions: List[str] = []


def _str_list(description: str) -> Dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}, "description": description}


# Schéma imposé à la réponse du modèle (structured outputs) ; mêmes champs que AiReport.
AI_REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "threat_level": {"type": "string", "enum": ["Critical", "High", "Moderate", "Low", "Clean"]},
        "executive_summary": {"type": "string", "description": "2-4 phrases de synthèse du risque"},
        "attack_vectors": _str_list("Vecteurs d'attaque probables exploitant ces données"),
        "data_exposure_analysis": {"type": "string", "description": "Analyse de la sensibilité des données exposées"},
        "recommendations": _str_list("Recommandations de sécurité concrètes"),
        "immediate_actions": _str_list("Actions immédiates prioritaires"),
    },
    "required": [
        "threat_level", "executive_summary", "attack_vectors",
        "data_exposure_analysis", "recommendations", "immediate_actions",
    ],
    "additionalProperties": False,
}


class Investigation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    target: str
    target_type: str
    score: int = 0
    risk_label: str = "Clean"
    total_breaches: int = 0
    total_records: int = 0
    exposed_data_classes: List[str] = []
    exposed_passwords: bool = False
    first_breach: str = ""
    latest_breach: str = ""
    breaches: List[Breach] = []
    yearwise: List[Dict[str, Any]] = []
    data_categories: List[Dict[str, Any]] = []
    ai_report: AiReport = Field(default_factory=AiReport)
    ai_generated: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------- Helpers ----------
def detect_type(target: str) -> str:
    t = target.strip()
    if EMAIL_RE.match(t):
        return "email"
    if DOMAIN_RE.match(t):
        return "domain"
    return "username"


def severity_for(exposed: List[str], records: int) -> str:
    low = [e.lower() for e in exposed]
    if any(any(s in e for s in SENSITIVE_DATA) for e in low):
        return "critical"
    if records >= 10_000_000:
        return "high"
    if records >= 500_000:
        return "medium"
    return "low"


def _get(url: str, params: dict = None) -> Any:
    try:
        r = requests.get(url, params=params, timeout=20,
                         headers={"User-Agent": "BreachRadar/1.0"})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"XON request failed {url}: {e}")
        return None


def _pwned_password_count(password: str) -> int:
    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    r = requests.get(f"https://api.pwnedpasswords.com/range/{prefix}", timeout=15,
                     headers={"User-Agent": "BreachRadar/1.0", "Add-Padding": "true"})
    r.raise_for_status()
    for line in r.text.splitlines():
        h, _, cnt = line.partition(":")
        if h.strip() == suffix:
            try:
                return int(cnt.strip())
            except ValueError:
                return 0
    return 0


def parse_analytics(data: dict) -> Dict[str, Any]:
    breaches: List[Breach] = []
    details = (data.get("ExposedBreaches") or {}).get("breaches_details") or []
    for d in details:
        exposed = [x.strip() for x in (d.get("xposed_data") or "").split(";") if x.strip()]
        records = int(d.get("xposed_records") or 0)
        breaches.append(Breach(
            name=d.get("breach", ""),
            title=d.get("breach", ""),
            domain=d.get("domain", "") or "",
            date=str(d.get("xposed_date", "") or ""),
            industry=d.get("industry", "") or "",
            logo=d.get("logo", "") or "",
            exposed_data=exposed,
            exposed_records=records,
            description=d.get("details", "") or "",
            verified=str(d.get("verified", "")).lower() == "yes",
            password_risk=d.get("password_risk", "") or "",
            reference=d.get("references", "") or "",
            severity=severity_for(exposed, records),
        ))
    metrics = data.get("BreachMetrics") or {}
    risk = (metrics.get("risk") or [{}])
    risk0 = risk[0] if risk else {}
    return {"breaches": breaches, "risk_label": risk0.get("risk_label", ""),
            "risk_score": int(risk0.get("risk_score") or 0)}


def parse_domain(data: dict) -> List[Breach]:
    out: List[Breach] = []
    for d in (data.get("exposedBreaches") or []):
        exposed = d.get("exposedData") or []
        records = int(d.get("exposedRecords") or 0)
        date = (d.get("breachedDate") or "")[:10]
        out.append(Breach(
            name=d.get("breachID", ""),
            title=d.get("breachID", ""),
            domain=d.get("domain", "") or "",
            date=date,
            industry=d.get("industry", "") or "",
            logo=d.get("logo", "") or "",
            exposed_data=exposed,
            exposed_records=records,
            description=d.get("exposureDescription", "") or "",
            verified=bool(d.get("verified")),
            password_risk=d.get("passwordRisk", "") or "",
            reference=d.get("referenceURL", "") or "",
            severity=severity_for(exposed, records),
        ))
    return out


async def gather_breaches(target: str, ttype: str) -> Dict[str, Any]:
    if ttype == "email":
        data = await asyncio.to_thread(_get, f"{XON_BASE}/breach-analytics", {"email": target})
        if not data:
            return {"breaches": [], "risk_score": 0, "risk_label": ""}
        return parse_analytics(data)
    if ttype == "domain":
        data = await asyncio.to_thread(_get, f"{XON_BASE}/breaches", {"domain": target})
        breaches = parse_domain(data) if data else []
        return {"breaches": breaches, "risk_score": 0, "risk_label": ""}
    # username: match against full catalog
    catalog = await asyncio.to_thread(_get, f"{XON_BASE}/breaches")
    kw = target.strip().lower()
    matched = []
    for d in (catalog.get("exposedBreaches") if catalog else []) or []:
        hay = (d.get("breachID", "") + " " + d.get("domain", "")).lower()
        if kw in hay:
            matched.append(d)
    breaches = parse_domain({"exposedBreaches": matched[:40]})
    return {"breaches": breaches, "risk_score": 0, "risk_label": ""}


def compute_stats(breaches: List[Breach], risk_score: int, risk_label: str) -> Dict[str, Any]:
    total = len(breaches)
    records = sum(b.exposed_records for b in breaches)
    classes = sorted({e for b in breaches for e in b.exposed_data})
    passwords = any("password" in e.lower() for b in breaches for e in b.exposed_data)
    years = [b.date[:4] for b in breaches if b.date and b.date[:4].isdigit()]
    first = min(years) if years else ""
    latest = max(years) if years else ""

    score = risk_score
    if not score and total:
        crit = sum(1 for b in breaches if b.severity == "critical")
        base = min(100, total * 8 + crit * 10)
        if passwords:
            base = min(100, base + 15)
        score = base
    label = risk_label
    if not label:
        if score == 0:
            label = "Clean"
        elif score < 30:
            label = "Low"
        elif score < 55:
            label = "Moderate"
        elif score < 80:
            label = "High"
        else:
            label = "Critical"
    return {"score": int(score), "risk_label": label, "total_breaches": total,
            "total_records": records, "exposed_data_classes": classes,
            "exposed_passwords": passwords, "first_breach": first, "latest_breach": latest}


def compute_yearwise(breaches: List[Breach]) -> List[Dict[str, Any]]:
    from collections import Counter
    c = Counter()
    for b in breaches:
        y = (b.date or "")[:4]
        if y.isdigit():
            c[y] += 1
    return [{"year": y, "count": c[y]} for y in sorted(c)]


CATEGORY_RULES = [
    ("Identifiants & Sécurité", "critical", [
        "password", "auth token", "security question", "pin", "mfa", "2fa", "encrypted", "salt",
    ]),
    ("Finances", "critical", [
        "credit card", "bank", "account balance", "financial", "purchase", "payment", "card", "transaction",
        "iban",
    ]),
    ("Identité personnelle", "high", [
        "name", "username", "gender", "date of birth", "social security", "government", "nationality",
        "licence", "license", "passport", "profile photo", "national id", "genders",
    ]),
    ("Contact & Communication", "medium", [
        "email", "phone", "instant messenger", "private message", "social media", "messenger", "contact",
    ]),
    ("Adresse & Localisation", "medium", [
        "physical address", "geographic", "location", "address", "spoken language",
    ]),
    ("Appareil & Réseau", "low", [
        "ip address", "device", "browser", "user agent", "website activity", "mac address", "cookie",
    ]),
    ("Emploi & Éducation", "low", [
        "job", "employer", "education", "occupation", "salary", "workplace",
    ]),
]


def categorize(data_class: str) -> tuple:
    low = data_class.lower()
    for name, sev, keys in CATEGORY_RULES:
        if any(k in low for k in keys):
            return name, sev
    return "Autres données", "low"


def compute_data_categories(breaches: List[Breach]) -> List[Dict[str, Any]]:
    from collections import Counter
    class_counts = Counter()
    cat_breach = Counter()
    cat_sev = {}
    cat_items = {}
    for b in breaches:
        seen_cats = set()
        for e in set(b.exposed_data):
            class_counts[(categorize(e)[0], e)] += 1
            cat, sev = categorize(e)
            seen_cats.add(cat)
            cat_sev[cat] = sev
        for c in seen_cats:
            cat_breach[c] += 1
    for (cat, name), cnt in class_counts.items():
        cat_items.setdefault(cat, []).append({"name": name, "count": cnt})
    out = []
    for cat, cnt in cat_breach.items():
        items = sorted(cat_items.get(cat, []), key=lambda x: x["count"], reverse=True)
        out.append({"category": cat, "count": cnt, "severity": cat_sev.get(cat, "low"), "items": items})
    return sorted(out, key=lambda x: x["count"], reverse=True)


async def generate_ai_report(target: str, ttype: str, stats: Dict, breaches: List[Breach]) -> AiReport:
    top = sorted(breaches, key=lambda b: b.exposed_records, reverse=True)[:15]
    breach_lines = [
        f"- {b.title} ({b.date}) | {b.exposed_records:,} enregistrements | données: {', '.join(b.exposed_data[:8])}"
        for b in top
    ]
    context = (
        f"Cible: {target} (type: {ttype})\n"
        f"Score de compromission: {stats['score']}/100 ({stats['risk_label']})\n"
        f"Nombre de fuites: {stats['total_breaches']} | Enregistrements exposés: {stats['total_records']:,}\n"
        f"Mots de passe exposés: {'OUI' if stats['exposed_passwords'] else 'Non'}\n"
        f"Types de données exposées: {', '.join(stats['exposed_data_classes'][:25])}\n"
        f"Période: {stats['first_breach']} - {stats['latest_breach']}\n\n"
        f"Fuites principales:\n" + "\n".join(breach_lines)
    )

    system = (
        "Tu es un analyste senior en cyber-renseignement (threat intelligence) dans un SOC. "
        "À partir des données réelles de fuites fournies, tu rédiges un rapport d'investigation "
        "professionnel, précis et actionnable, EN FRANÇAIS."
    )

    if not breaches:
        system += (
            "\nNote: aucune fuite trouvée, threat_level doit être 'Clean' "
            "et rassure tout en conseillant la vigilance."
        )

    try:
        resp = await get_llm_client().beta.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": context}],
            output_config={
                "effort": "medium",
                "format": {"type": "json_schema", "schema": AI_REPORT_SCHEMA},
            },
            # En cas de refus des filtres de sécurité, l'API relance sur le modèle de repli recommandé.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if resp.stop_reason != "end_turn":
            raise RuntimeError(f"réponse incomplète (stop_reason={resp.stop_reason})")
        text = next(b.text for b in resp.content if b.type == "text")
        return AiReport.model_validate_json(text)
    except Exception as e:
        logger.error(f"AI report generation failed: {e}")
        return fallback_report(stats)


def fallback_report(stats: Dict) -> AiReport:
    vectors = ["Hameçonnage ciblé (spear phishing)"]
    if stats["exposed_passwords"]:
        vectors.insert(0, "Credential stuffing")
    return AiReport(
        threat_level=stats["risk_label"],
        executive_summary=(
            f"L'investigation a identifié {stats['total_breaches']} fuite(s) associée(s) à cette cible, "
            f"exposant environ {stats['total_records']:,} enregistrements. "
            "L'analyse IA détaillée est momentanément indisponible."
        ),
        attack_vectors=vectors,
        data_exposure_analysis="Analyse basée sur les types de données exposées dans les fuites détectées.",
        recommendations=["Changer les mots de passe réutilisés", "Activer l'authentification à deux facteurs (2FA)"],
        immediate_actions=["Réinitialiser les identifiants compromis"],
    )


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "BreachRadar AI opérationnel"}


async def analyze_target(target: str):
    ttype = detect_type(target)
    result = await gather_breaches(target, ttype)
    breaches: List[Breach] = result["breaches"]
    stats = compute_stats(breaches, result.get("risk_score", 0), result.get("risk_label", ""))
    return ttype, breaches, stats


async def build_investigation(target: str, with_ai: bool = True) -> Investigation:
    ttype, breaches, stats = await analyze_target(target)
    yearwise = compute_yearwise(breaches)
    data_categories = compute_data_categories(breaches)
    if with_ai:
        ai_report = await generate_ai_report(target, ttype, stats, breaches)
    else:
        ai_report = AiReport(threat_level=stats["risk_label"])
    inv = Investigation(
        target=target, target_type=ttype, score=stats["score"], risk_label=stats["risk_label"],
        total_breaches=stats["total_breaches"], total_records=stats["total_records"],
        exposed_data_classes=stats["exposed_data_classes"], exposed_passwords=stats["exposed_passwords"],
        first_breach=stats["first_breach"], latest_breach=stats["latest_breach"],
        breaches=breaches, yearwise=yearwise, data_categories=data_categories,
        ai_report=ai_report, ai_generated=with_ai,
    )
    await db.investigations.insert_one(inv.model_dump())
    return inv


@api_router.post("/investigate", response_model=Investigation)
async def investigate(req: InvestigateRequest):
    target = req.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Cible vide")
    return await build_investigation(target, with_ai=True)


@api_router.post("/investigate/batch", response_model=List[Investigation])
async def investigate_batch(req: BatchRequest):
    targets, seen = [], set()
    for t in req.targets:
        t = t.strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            targets.append(t)
    targets = targets[:15]
    if not targets:
        raise HTTPException(status_code=400, detail="Aucune cible valide")
    results = []
    for t in targets:
        try:
            results.append(await build_investigation(t, with_ai=False))
        except Exception as e:
            logger.error(f"batch item failed {t}: {e}")
    return results


@api_router.post("/investigation/{inv_id}/report", response_model=Investigation)
async def generate_report(inv_id: str):
    doc = await db.investigations.find_one({"id": inv_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Investigation introuvable")
    inv = Investigation(**doc)
    if not inv.ai_generated:
        stats = {
            "score": inv.score, "risk_label": inv.risk_label, "total_breaches": inv.total_breaches,
            "total_records": inv.total_records, "exposed_data_classes": inv.exposed_data_classes,
            "exposed_passwords": inv.exposed_passwords, "first_breach": inv.first_breach,
            "latest_breach": inv.latest_breach,
        }
        inv.ai_report = await generate_ai_report(inv.target, inv.target_type, stats, inv.breaches)
        inv.ai_generated = True
        await db.investigations.update_one(
            {"id": inv_id},
            {"$set": {"ai_report": inv.ai_report.model_dump(), "ai_generated": True}},
        )
    return inv


@api_router.post("/check-password")
async def check_password(req: PasswordCheckRequest):
    if not req.password:
        raise HTTPException(status_code=400, detail="Mot de passe vide")
    try:
        count = await asyncio.to_thread(_pwned_password_count, req.password)
    except Exception as e:
        logger.error(f"pwned password check failed: {e}")
        raise HTTPException(status_code=502, detail="Service de vérification indisponible")
    return {"pwned": count > 0, "count": count}


@api_router.get("/history", response_model=List[Investigation])
async def history():
    docs = await db.investigations.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [Investigation(**d) for d in docs]


@api_router.get("/investigation/{inv_id}", response_model=Investigation)
async def get_investigation(inv_id: str):
    doc = await db.investigations.find_one({"id": inv_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Investigation introuvable")
    return Investigation(**doc)


@api_router.delete("/investigation/{inv_id}")
async def delete_investigation(inv_id: str):
    await db.investigations.delete_one({"id": inv_id})
    return {"ok": True}


@api_router.delete("/history")
async def clear_history():
    await db.investigations.delete_many({})
    return {"ok": True}


async def _refresh_watch(watch: Watch) -> Watch:
    ttype, breaches, stats = await analyze_target(watch.target)
    current = sorted({b.name for b in breaches})
    prev = set(watch.breach_names)
    new = [n for n in current if n not in prev]
    watch.target_type = ttype
    watch.breach_names = current
    watch.score = stats["score"]
    watch.risk_label = stats["risk_label"]
    watch.total_breaches = stats["total_breaches"]
    watch.latest_breach = stats["latest_breach"]
    if new:
        watch.new_breaches = sorted(set(watch.new_breaches) | set(new))
        watch.has_new = True
    watch.last_checked = datetime.now(timezone.utc).isoformat()
    return watch


@api_router.post("/watchlist", response_model=Watch)
async def add_watch(req: WatchCreate):
    target = req.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Cible vide")
    existing = await db.watchlist.find_one(
        {"target": {"$regex": f"^{re.escape(target)}$", "$options": "i"}}, {"_id": 0}
    )
    if existing:
        return Watch(**existing)
    ttype, breaches, stats = await analyze_target(target)
    watch = Watch(
        target=target, target_type=ttype, score=stats["score"], risk_label=stats["risk_label"],
        total_breaches=stats["total_breaches"], latest_breach=stats["latest_breach"],
        breach_names=sorted({b.name for b in breaches}),
    )
    await db.watchlist.insert_one(watch.model_dump())
    return watch


@api_router.get("/watchlist", response_model=List[Watch])
async def get_watchlist():
    docs = await db.watchlist.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [Watch(**d) for d in docs]


@api_router.post("/watchlist/{wid}/check", response_model=Watch)
async def check_watch(wid: str):
    doc = await db.watchlist.find_one({"id": wid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Surveillance introuvable")
    watch = await _refresh_watch(Watch(**doc))
    await db.watchlist.update_one({"id": wid}, {"$set": watch.model_dump()})
    return watch


@api_router.post("/watchlist/check-all", response_model=List[Watch])
async def check_all_watches():
    docs = await db.watchlist.find({}, {"_id": 0}).to_list(100)
    out = []
    for d in docs:
        try:
            watch = await _refresh_watch(Watch(**d))
            await db.watchlist.update_one({"id": watch.id}, {"$set": watch.model_dump()})
            out.append(watch)
        except Exception as e:
            logger.error(f"watch check failed {d.get('target')}: {e}")
            out.append(Watch(**d))
    return out


@api_router.post("/watchlist/{wid}/seen", response_model=Watch)
async def mark_watch_seen(wid: str):
    doc = await db.watchlist.find_one({"id": wid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Surveillance introuvable")
    await db.watchlist.update_one({"id": wid}, {"$set": {"has_new": False, "new_breaches": []}})
    doc.update({"has_new": False, "new_breaches": []})
    return Watch(**doc)


@api_router.delete("/watchlist/{wid}")
async def delete_watch(wid: str):
    await db.watchlist.delete_one({"id": wid})
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
