export const SEVERITY = {
  critical: { label: "Critique", text: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" },
  high: { label: "Élevée", text: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/30", dot: "bg-orange-500" },
  medium: { label: "Moyenne", text: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-500" },
  low: { label: "Faible", text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500" },
};

export const RISK = {
  Critical: { label: "Risque Critique", color: "#EF4444" },
  High: { label: "Risque Élevé", color: "#F97316" },
  Moderate: { label: "Risque Modéré", color: "#F59E0B" },
  Low: { label: "Risque Faible", color: "#10B981" },
  Clean: { label: "Aucune Exposition", color: "#22C55E" },
  Unknown: { label: "Indéterminé", color: "#64748B" },
};

export const riskInfo = (label) => RISK[label] || RISK.Unknown;

export const scoreColor = (score) => {
  if (score >= 80) return "#EF4444";
  if (score >= 55) return "#F97316";
  if (score >= 30) return "#F59E0B";
  if (score > 0) return "#38BDF8";
  return "#22C55E";
};

export const formatNumber = (n) => {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString("fr-FR");
};

const SENSITIVE = ["password", "credit card", "social security", "government", "bank", "auth token", "private message"];
export const isSensitive = (dataClass) =>
  SENSITIVE.some((s) => dataClass.toLowerCase().includes(s));

export const CATEGORY_RULES = [
  ["Identifiants & Sécurité", ["password", "auth token", "security question", "pin", "mfa", "2fa", "encrypted", "salt"]],
  ["Finances", ["credit card", "bank", "account balance", "financial", "purchase", "payment", "card", "transaction", "iban"]],
  ["Identité personnelle", ["name", "username", "gender", "date of birth", "social security", "government", "nationality", "licence", "license", "passport", "profile photo", "national id"]],
  ["Contact & Communication", ["email", "phone", "instant messenger", "private message", "social media", "messenger", "contact"]],
  ["Adresse & Localisation", ["physical address", "geographic", "location", "address", "spoken language"]],
  ["Appareil & Réseau", ["ip address", "device", "browser", "user agent", "website activity", "mac address", "cookie"]],
  ["Emploi & Éducation", ["job", "employer", "education", "occupation", "salary", "workplace"]],
];

export const categorize = (dataClass) => {
  const low = (dataClass || "").toLowerCase();
  for (const [name, keys] of CATEGORY_RULES) if (keys.some((k) => low.includes(k))) return name;
  return "Autres données";
};
