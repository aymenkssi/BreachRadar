import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileWarning, Loader2, ShieldCheck, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { PremiumLock } from "@/components/account/PremiumLock";
import { getMonitors, getPasswordReport, errorMessage } from "@/lib/api";
import { SEVERITY } from "@/lib/format";

const RISK_ORDER = ["plaintext", "easytocrack", "hardtocrack", "unknown"];
const RISK_TITLES = {
  plaintext: "En clair", easytocrack: "Chiffrement faible", hardtocrack: "Chiffrement robuste", unknown: "Inconnue",
};

export const PasswordReportPanel = ({ onUpgrade }) => {
  const { user } = useAuth();
  const [emails, setEmails] = useState([]);
  const [email, setEmail] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user.premium) return;
    setEmail(user.email);
    getMonitors()
      .then((d) => setEmails([...new Set([user.email, ...d.monitors.filter((m) => m.verified).map((m) => m.email)])]))
      .catch(() => setEmails([user.email]));
  }, [user.premium, user.email]);

  if (!user.premium) {
    return <PremiumLock onUpgrade={onUpgrade}
      text="Découvrez, fuite par fuite, comment vos mots de passe ont été exposés et lesquels changer en priorité." />;
  }

  const run = async () => {
    setLoading(true);
    setReport(null);
    try { setReport(await getPasswordReport(email)); }
    catch (err) { toast.error(errorMessage(err, "Rapport indisponible.")); }
    finally { setLoading(false); }
  };

  const sev = report ? SEVERITY[report.level] : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pour vos adresses vérifiées uniquement. Les mots de passe eux-mêmes ne sont jamais affichés ni conservés :
        le rapport indique comment chaque service les protégeait et quoi faire.
      </p>
      <div className="flex gap-2">
        <select value={email} onChange={(e) => setEmail(e.target.value)} data-testid="report-email-select"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm">
          {emails.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <Button size="sm" onClick={run} disabled={loading || !email} className="gap-1.5" data-testid="report-run-btn">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileWarning className="h-4 w-4" />} Analyser
        </Button>
      </div>

      {report && report.password_breaches === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <ShieldCheck className="h-6 w-6 flex-shrink-0 text-emerald-500" />
          <p className="text-sm">Aucune fuite connue n'a exposé de mot de passe pour <b>{report.email}</b>
            {report.total_breaches > 0 && <> ({report.total_breaches} fuite(s) sans mot de passe)</>}.</p>
        </div>
      )}

      {report && report.password_breaches > 0 && (
        <div className="space-y-4" data-testid="password-report">
          <div className={`rounded-xl border p-4 ${sev.border} ${sev.bg}`}>
            <p className={`font-heading font-semibold ${sev.text}`}>
              {report.password_breaches} fuite(s) avec mot de passe · urgence {sev.label.toLowerCase()}
            </p>
            {report.latest_password_leak && (
              <p className="mt-1 text-xs text-muted-foreground">Dernière fuite de mot de passe : {report.latest_password_leak}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {RISK_ORDER.map((k) => (
              <div key={k} className="rounded-lg border border-border p-2.5">
                <p className="font-heading text-lg font-bold">{report.counts[k]}</p>
                <p className="text-[11px] text-muted-foreground">{RISK_TITLES[k]}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-mono-x uppercase tracking-wider text-muted-foreground">
              <ListChecks className="h-4 w-4" /> Plan d'action
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {report.actions.map((a) => <li key={a}>{a}</li>)}
            </ol>
          </div>

          <div className="space-y-2">
            {report.entries.map((e) => {
              const s = SEVERITY[e.level];
              return (
                <div key={`${e.breach}-${e.date}`} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{e.breach}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>{e.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{[e.domain, e.date].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{e.advice}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
