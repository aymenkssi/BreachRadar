import { useEffect, useState } from "react";
import { BellRing, Database, ShieldAlert, Users } from "lucide-react";
import { getStats } from "@/lib/api";

const integer = new Intl.NumberFormat("fr-FR");
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

// Tendance sur ~30 jours. bad=true : une hausse est une mauvaise nouvelle (rouge), sinon verte.
const Trend = ({ trend, bad = true }) => {
  if (!trend || trend.pct === 0) return null;
  const up = trend.pct > 0;
  const color = up === bad ? "text-red-500" : "text-emerald-500";
  return (
    <span className={`text-xs font-semibold ${color}`} title={`Évolution sur ${trend.days} jours`}>
      {up ? "+" : ""}{trend.pct.toLocaleString("fr-FR")} %
    </span>
  );
};

const Card = ({ label, value, trend, bad, sub, icon: Icon, testid }) => (
  <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card/80 p-4 shadow-lg backdrop-blur-md sm:p-5"
    data-testid={testid}>
    <div className="min-w-0">
      <p className="text-[10px] font-mono-x uppercase tracking-wider text-muted-foreground sm:text-[11px]">{label}</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="font-heading text-xl font-bold sm:text-3xl">{value}</span>
        <Trend trend={trend} bad={bad} />
      </p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{sub}</p>}
    </div>
    <div className="hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
      <Icon className="h-5 w-5" />
    </div>
  </div>
);

export const ThreatStats = () => {
  const [data, setData] = useState(null);
  useEffect(() => { getStats().then(setData).catch(() => setData({ available: false })); }, []);
  if (!data?.available) return null;
  const t = data.trends || {};
  const pct = data.breaches ? Math.round((data.critical_breaches / data.breaches) * 100) : 0;
  return (
    <section className="mb-8" data-testid="threat-stats">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold sm:text-2xl">Panorama des fuites de données</h2>
          <p className="text-sm text-muted-foreground">Fuites rendues publiques et recensées par XposedOrNot, actualisé toutes les heures.</p>
        </div>
        {data.source_ok ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Sources opérationnelles
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Source indisponible : derniers chiffres connus
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card testid="stat-breaches" label="Fuites recensées" value={integer.format(data.breaches)} trend={t.breaches}
          icon={Database} sub="services piratés ou exposés" />
        <Card testid="stat-records" label="Comptes exposés" value={compact.format(data.records)} trend={t.records}
          icon={Users} sub="enregistrements divulgués" />
        <Card testid="stat-critical" label="Fuites critiques" value={integer.format(data.critical_breaches)}
          icon={ShieldAlert} sub={`${pct} % des fuites (mots de passe, banque, identité…)`} />
        <Card testid="stat-monitored" label="Adresses surveillées" value={integer.format(data.monitored_addresses)}
          trend={t.monitored_addresses} bad={false} icon={BellRing} sub="veille BreachRadar Premium" />
      </div>
    </section>
  );
};
