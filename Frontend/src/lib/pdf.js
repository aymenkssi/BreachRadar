import { jsPDF } from "jspdf";
import { formatNumber, riskInfo } from "@/lib/format";

export function generateReportPdf(inv) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const maxW = W - M * 2;
  let y = M;

  const info = riskInfo(inv.risk_label);
  const rgb = hexToRgb(info.color);

  const ensure = (h) => {
    if (y + h > doc.internal.pageSize.getHeight() - M) {
      doc.addPage();
      y = M;
    }
  };

  // Header band
  doc.setFillColor(9, 13, 22);
  doc.rect(0, 0, W, 96, "F");
  doc.setTextColor(56, 189, 248);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("BreachRadar AI", M, 44);
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Rapport d'investigation de fuites de donnees", M, 64);
  doc.setFontSize(9);
  doc.text(new Date(inv.created_at || Date.now()).toLocaleString("fr-FR"), M, 80);
  y = 128;

  // Target + score
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Cible : ${inv.target}`, M, y);
  y += 22;

  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.roundedRect(M, y - 12, 150, 26, 6, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(`Score ${inv.score}/100 - ${info.label}`, M + 12, y + 5);
  y += 40;

  // Stats
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const stats = [
    `Fuites detectees : ${inv.total_breaches}`,
    `Enregistrements exposes : ${formatNumber(inv.total_records)}`,
    `Mots de passe : ${inv.exposed_passwords ? "Exposes" : "Aucun"}`,
    `Periode : ${inv.first_breach ? inv.first_breach + " - " + inv.latest_breach : "N/A"}`,
  ];
  stats.forEach((s) => { doc.text(s, M, y); y += 16; });
  y += 8;

  const rep = inv.ai_report || {};
  const section = (title, body) => {
    if (!body || (Array.isArray(body) && body.length === 0)) return;
    ensure(40);
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y, W - M, y);
    y += 18;
    doc.setTextColor(2, 132, 199);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), M, y);
    y += 16;
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const items = Array.isArray(body) ? body : [body];
    items.forEach((it) => {
      const prefix = Array.isArray(body) ? "- " : "";
      const lines = doc.splitTextToSize(prefix + it, maxW);
      lines.forEach((ln) => { ensure(14); doc.text(ln, M, y); y += 14; });
      if (Array.isArray(body)) y += 2;
    });
    y += 10;
  };

  section("Niveau de menace", rep.threat_level || inv.risk_label);
  section("Synthese executive", rep.executive_summary);
  section("Vecteurs d'attaque", rep.attack_vectors);
  section("Analyse de l'exposition", rep.data_exposure_analysis);
  section("Actions immediates", rep.immediate_actions);
  section("Recommandations", rep.recommendations);

  // Breaches list
  if (inv.breaches?.length) {
    ensure(40);
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y, W - M, y);
    y += 18;
    doc.setTextColor(2, 132, 199);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("FUITES DETECTEES", M, y);
    y += 16;
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    inv.breaches.slice(0, 40).forEach((b) => {
      const line = `- ${b.title} (${b.date || "?"}) - ${formatNumber(b.exposed_records)} enreg. - ${b.exposed_data.slice(0, 6).join(", ")}`;
      const lines = doc.splitTextToSize(line, maxW);
      lines.forEach((ln) => { ensure(12); doc.text(ln, M, y); y += 12; });
    });
  }

  doc.save(`rapport-breachradar-${inv.target}.pdf`);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
