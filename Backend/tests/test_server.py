import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import server
from server import Breach, compute_data_categories, compute_stats, detect_type, severity_for


def make_breach(**kw):
    base = {"name": "Acme", "title": "Acme", "date": "2021-05-01", "exposed_records": 1000}
    base.update(kw)
    return Breach(**base)


@pytest.mark.parametrize("target,expected", [
    ("alice@example.com", "email"),
    ("example.com", "domain"),
    ("sub.example.co.uk", "domain"),
    ("alice_42", "username"),
])
def test_detect_type(target, expected):
    assert detect_type(target) == expected


def test_severity_for():
    assert severity_for(["Passwords", "Emails"], 10) == "critical"
    assert severity_for(["Emails"], 20_000_000) == "high"
    assert severity_for(["Emails"], 600_000) == "medium"
    assert severity_for(["Emails"], 10) == "low"


def test_compute_stats_without_breaches_is_clean():
    stats = compute_stats([], 0, "")
    assert stats["score"] == 0
    assert stats["risk_label"] == "Clean"


def test_compute_stats_scores_passwords_and_years():
    breaches = [
        make_breach(exposed_data=["Passwords"], severity="critical", date="2019-01-01"),
        make_breach(name="B", exposed_data=["Emails"], date="2023-02-02", exposed_records=500),
    ]
    stats = compute_stats(breaches, 0, "")
    assert stats["score"] == 2 * 8 + 10 + 15
    assert stats["risk_label"] == "Moderate"
    assert stats["exposed_passwords"] is True
    assert (stats["first_breach"], stats["latest_breach"]) == ("2019", "2023")
    assert stats["total_records"] == 1500


def test_compute_data_categories_groups_by_category():
    cats = compute_data_categories([make_breach(exposed_data=["Passwords", "Email addresses"])])
    names = {c["category"]: c["severity"] for c in cats}
    assert names["Identifiants & Sécurité"] == "critical"
    assert names["Contact & Communication"] == "medium"


REPORT = {
    "threat_level": "High",
    "executive_summary": "Résumé.",
    "attack_vectors": ["Credential stuffing"],
    "data_exposure_analysis": "Analyse.",
    "recommendations": ["Activer la 2FA"],
    "immediate_actions": ["Changer le mot de passe"],
}


def fake_llm(response=None, error=None):
    create = AsyncMock(return_value=response, side_effect=error)
    return MagicMock(beta=MagicMock(messages=MagicMock(create=create))), create


def run_report(monkeypatch, llm, breaches):
    monkeypatch.setattr(server, "get_llm_client", lambda: llm)
    stats = compute_stats(breaches, 0, "")
    return asyncio.run(server.generate_ai_report("alice@example.com", "email", stats, breaches))


def test_generate_ai_report_parses_structured_output(monkeypatch):
    resp = SimpleNamespace(stop_reason="end_turn",
                           content=[SimpleNamespace(type="text", text=json.dumps(REPORT))])
    llm, create = fake_llm(resp)
    report = run_report(monkeypatch, llm, [make_breach(exposed_data=["Passwords"])])
    assert report.model_dump() == REPORT
    kwargs = create.call_args.kwargs
    assert kwargs["model"] == server.ANTHROPIC_MODEL
    assert kwargs["output_config"]["format"]["schema"] is server.AI_REPORT_SCHEMA


def test_generate_ai_report_falls_back_on_api_error(monkeypatch):
    llm, _ = fake_llm(error=RuntimeError("boom"))
    report = run_report(monkeypatch, llm, [make_breach(exposed_data=["Passwords"])])
    assert report.attack_vectors[0] == "Credential stuffing"
    assert "indisponible" in report.executive_summary


def test_generate_ai_report_falls_back_on_refusal(monkeypatch):
    llm, _ = fake_llm(SimpleNamespace(stop_reason="refusal", content=[]))
    report = run_report(monkeypatch, llm, [])
    assert report.threat_level == "Clean"
    assert report.attack_vectors == ["Hameçonnage ciblé (spear phishing)"]


def test_schema_matches_ai_report_fields():
    assert set(server.AI_REPORT_SCHEMA["required"]) == set(server.AiReport.model_fields)
