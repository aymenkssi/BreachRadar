import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, MailCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import { PremiumLock } from "@/components/account/PremiumLock";
import {
  getMonitors, addMonitor, verifyMonitor, resendMonitorCode, markMonitorSeen, deleteMonitor, errorMessage,
} from "@/lib/api";

const PendingMonitor = ({ monitor, onDone }) => {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyMonitor(monitor.id, code);
      toast.success(`${monitor.email} est maintenant surveillée.`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Code invalide."));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    try { await resendMonitorCode(monitor.id); toast.success("Nouveau code envoyé."); }
    catch (err) { toast.error(errorMessage(err, "Envoi impossible.")); }
  };

  return (
    <form onSubmit={confirm} className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">Saisissez le code envoyé à cette adresse pour prouver qu'elle vous appartient.</p>
      <div className="flex gap-2">
        <Input inputMode="numeric" maxLength={6} value={code} placeholder="000000"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-mono-x tracking-[0.3em]" />
        <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Valider"}
        </Button>
      </div>
      <button type="button" onClick={resend} className="text-xs text-muted-foreground hover:text-foreground">Renvoyer le code</button>
    </form>
  );
};

export const MonitorsPanel = ({ onUpgrade }) => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getMonitors()); } catch { setData({ limit: 0, monitors: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!user.premium) {
    return <PremiumLock onUpgrade={onUpgrade}
      text="Surveillez vos adresses e-mail chaque jour et recevez une alerte dès qu'elles apparaissent dans une nouvelle fuite." />;
  }
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const monitors = data.monitors;
  const ownMissing = !monitors.some((m) => m.email === user.email);

  const add = async (value) => {
    setAdding(true);
    try {
      const m = await addMonitor(value);
      toast.success(m.verified ? `${m.email} est maintenant surveillée.` : `Code de confirmation envoyé à ${m.email}.`);
      setEmail("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Ajout impossible."));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Vérification chaque jour ; une alerte est envoyée à <span className="text-foreground">{user.email}</span> dès
        qu'une nouvelle fuite apparaît. {monitors.length} / {data.limit} adresses.
      </p>

      {ownMissing && monitors.length < data.limit && (
        <Button variant="outline" size="sm" className="w-full gap-2" disabled={adding} onClick={() => add(user.email)}
          data-testid="monitor-own-btn">
          <ShieldCheck className="h-4 w-4" /> Surveiller mon adresse {user.email}
        </Button>
      )}

      {monitors.length < data.limit && (
        <form onSubmit={(e) => { e.preventDefault(); if (email) add(email); }} className="flex gap-2">
          <Input type="email" required placeholder="autre.adresse@exemple.fr" value={email}
            onChange={(e) => setEmail(e.target.value)} data-testid="monitor-email-input" />
          <Button type="submit" size="sm" disabled={adding} className="gap-1.5" data-testid="monitor-add-btn">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
          </Button>
        </form>
      )}

      <div className="space-y-2" data-testid="monitor-list">
        {monitors.map((m) => (
          <div key={m.id} className={`rounded-xl border p-3 ${m.has_new ? "border-red-500/40 bg-red-500/5" : "border-border bg-background/50"}`}>
            <div className="flex items-center gap-3">
              <MailCheck className={`h-5 w-5 flex-shrink-0 ${m.verified ? "text-primary" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono-x text-sm">{m.email}</p>
                <p className="text-xs text-muted-foreground">
                  {m.verified
                    ? <>{m.total_breaches} fuite(s) connue(s){m.last_checked && <> · vérifiée le {new Date(m.last_checked).toLocaleDateString("fr-FR")}</>}</>
                    : "En attente de confirmation"}
                </p>
              </div>
              <button onClick={async () => { await deleteMonitor(m.id); load(); }} className="text-muted-foreground hover:text-red-500"
                aria-label={`Arrêter la surveillance de ${m.email}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {!m.verified && <PendingMonitor monitor={m} onDone={load} />}
            {m.has_new && (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5" /> {m.new_breaches.length} nouvelle(s) fuite(s)
                </p>
                <div className="flex flex-wrap gap-1">
                  {m.new_breaches.map((n) => (
                    <span key={n} className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono-x text-[11px] text-red-500">{n}</span>
                  ))}
                </div>
                <button onClick={async () => { await markMonitorSeen(m.id); load(); }}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <Check className="h-3 w-3" /> Marquer comme lu
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
