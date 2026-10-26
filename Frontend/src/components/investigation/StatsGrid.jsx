import { Database, KeyRound, Layers, CalendarClock } from "lucide-react";
import { formatNumber } from "@/lib/format";

const Stat = ({ icon: Icon, label, value, accent, testid }) => (
  <div data-testid={testid} className="rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/30">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className={`h-4 w-4 ${accent || ""}`} />
      <span className="text-[11px] font-mono-x uppercase tracking-wider">{label}</span>
    </div>
    <div className="mt-2 font-mono-x text-2xl font-bold tracking-tight text-foreground">{value}</div>
  </div>
);

export const StatsGrid = ({ data }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Stat testid="stat-breaches" icon={Database} label="Fuites détectées" value={data.total_breaches} accent="text-primary" />
    <Stat testid="stat-records" icon={Layers} label="Enregistrements" value={formatNumber(data.total_records)} accent="text-orange-400" />
    <Stat
      testid="stat-passwords"
      icon={KeyRound}
      label="Mots de passe"
      value={data.exposed_passwords ? "Exposés" : "Aucun"}
      accent={data.exposed_passwords ? "text-red-500" : "text-emerald-500"}
    />
    <Stat
      testid="stat-period"
      icon={CalendarClock}
      label="Période"
      value={data.first_breach ? `${data.first_breach}–${data.latest_breach}` : "—"}
      accent="text-sky-400"
    />
  </div>
);
