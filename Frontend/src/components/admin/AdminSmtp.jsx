import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCcw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, errorMessage } from "@/lib/api";
import { Card, Field, SecretField, fmtDate } from "@/components/admin/common";

export const EmailQuota = ({ usage }) => {
  const pct = Math.min(100, Math.round((usage.primary.sent / usage.limit) * 100));
  const color = usage.limit_reached ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  const max = Math.max(1, ...usage.history.map((h) => h.primary_sent + h.fallback_sent));
  return (
    <div className="space-y-4" data-testid="email-quota">
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>Service principal {usage.primary.label && <span className="text-muted-foreground">({usage.primary.label})</span>}</span>
          <span className="font-mono-x">{usage.primary.sent} / {usage.limit}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-muted-foreground">
          {usage.limit_reached
            ? usage.fallback.configured ? `Limite atteinte : bascule sur le secours (${usage.fallback.label})` : "Limite atteinte et aucun service de secours : les e-mails ne partent plus aujourd'hui."
            : `${usage.primary.remaining} envoi(s) restant(s) aujourd'hui (jour UTC).`}
          {usage.provider_quota_hit && " Le fournisseur a signalé son quota."}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-border p-2"><p className="font-heading text-lg font-bold">{usage.fallback.sent}</p>par le secours</div>
        <div className="rounded-lg border border-border p-2"><p className="font-heading text-lg font-bold">{usage.primary.failed + usage.fallback.failed}</p>échecs</div>
        <div className="rounded-lg border border-border p-2"><p className="font-heading text-lg font-bold">{usage.skipped}</p>non envoyés</div>
      </div>
      {[usage.primary.last_error, usage.fallback.last_error].filter(Boolean).map((e) => (
        <p key={e.at} className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{fmtDate(e.at, true)} — {e.message}</p>
      ))}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">14 derniers jours</p>
        <div className="flex h-16 items-end gap-1">
          {usage.history.map((h) => (
            <div key={h.date} className="flex flex-1 flex-col justify-end" title={`${h.date} : ${h.primary_sent} principal, ${h.fallback_sent} secours, ${h.failed} échec(s)`}>
              <div className="bg-amber-500" style={{ height: `${(h.fallback_sent / max) * 100}%` }} />
              <div className="bg-primary" style={{ height: `${(h.primary_sent / max) * 100}%`, minHeight: h.primary_sent ? 2 : 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AdminSmtp = () => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [testTo, setTestTo] = useState("");

  const load = (d) => {
    setData(d);
    setForm({
      host: d.host || d.brevo_defaults.host, port: d.port || d.brevo_defaults.port, security: d.security || d.brevo_defaults.security,
      username: d.username, from_address: d.from_address, sender_name: d.sender_name || "BreachRadar",
      daily_limit: d.daily_limit, password: "", clear_password: false,
    });
  };
  useEffect(() => { admin.smtp().then(load).catch((err) => toast.error(errorMessage(err, "Chargement impossible."))); }, []);
  if (!form) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const act = async (name, fn, ok) => {
    setBusy(name);
    try { const r = await fn(); if (r?.usage) load(r); toast.success(ok(r)); }
    catch (err) { toast.error(errorMessage(err, "Opération impossible.")); }
    finally { setBusy(null); }
  };
  const save = (e) => {
    e.preventDefault();
    act("save", () => admin.saveSmtp({ ...form, port: Number(form.port), daily_limit: Number(form.daily_limit), password: form.password || null }),
      () => "Configuration enregistrée.");
  };
  const refresh = () => act("refresh", async () => ({ ...data, usage: await admin.smtpUsage() }), () => "Compteur actualisé.");

  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center justify-between">Quota d'envoi
        <Button size="sm" variant="ghost" onClick={refresh} disabled={busy === "refresh"}><RefreshCw className="h-4 w-4" /></Button></span>}>
        <EmailQuota usage={data.usage} />
      </Card>

      <form onSubmit={save}>
        <Card title="Serveur SMTP principal">
          <p className="mb-4 text-xs text-muted-foreground">
            {data.source === "admin" ? `Configuration de l'admin (modifiée le ${fmtDate(data.updated_at, true)} par ${data.updated_by}).`
              : data.source === "env" ? "Aucune configuration enregistrée : le fichier .env est utilisé." : "Aucun service d'envoi configuré."}
            {" "}Au-delà de la limite journalière, ou si ce serveur refuse un envoi, les e-mails partent par les variables SMTP_* du .env
            {data.fallback.configured ? ` (${data.fallback.label}).` : " (non configuré)."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="host" label="Serveur" value={form.host} onChange={set("host")} required />
            <div className="grid grid-cols-2 gap-2">
              <Field id="port" label="Port" type="number" value={form.port} onChange={set("port")} required />
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="sec">Sécurité</label>
                <select id="sec" value={form.security} onChange={set("security")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">Aucune</option>
                </select>
              </div>
            </div>
            <Field id="user" label="Identifiant" value={form.username} onChange={set("username")} hint="Brevo : SMTP & API → SMTP" />
            <SecretField id="pwd" label="Mot de passe / clé SMTP" isSet={data.password_set} value={form.password} onChange={set("password")}
              cleared={form.clear_password} onClear={() => setForm((f) => ({ ...f, clear_password: true, password: "" }))} />
            <Field id="from" label="Adresse d'expédition" type="email" value={form.from_address} onChange={set("from_address")} required
              hint="Sur un domaine authentifié (SPF/DKIM), ex. alertes@breachradar.fr" />
            <Field id="name" label="Nom d'expéditeur" value={form.sender_name} onChange={set("sender_name")} required />
            <Field id="limit" label="Limite d'envois par jour" type="number" min={1} value={form.daily_limit} onChange={set("daily_limit")} required
              hint="Brevo gratuit : 300 / jour" />
          </div>
          {data.password_unreadable && <p className="mt-3 text-xs text-red-500">Le mot de passe enregistré est illisible (clé de chiffrement modifiée) : saisissez-le à nouveau.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy === "save"} className="gap-2">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
            </Button>
            {data.source === "admin" && (
              <Button type="button" variant="outline" className="gap-2" disabled={busy === "reset"}
                onClick={() => window.confirm("Supprimer cette configuration et revenir au fichier .env ?") && act("reset", admin.resetSmtp, () => "Configuration supprimée.")}>
                <RotateCcw className="h-4 w-4" /> Revenir au .env
              </Button>
            )}
          </div>
        </Card>
      </form>

      <Card title="E-mail de test">
        <div className="flex flex-wrap gap-2">
          <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="destinataire (par défaut : votre adresse)" className="min-w-[240px] flex-1" />
          <Button variant="outline" className="gap-2" disabled={busy === "test"}
            onClick={() => act("test", () => admin.testSmtp(testTo, "primary"), (r) => `E-mail envoyé à ${r.sent_to}.`)}>
            <Send className="h-4 w-4" /> Principal
          </Button>
          {data.fallback.configured && (
            <Button variant="outline" className="gap-2" disabled={busy === "test"}
              onClick={() => act("test", () => admin.testSmtp(testTo, "fallback"), (r) => `E-mail envoyé à ${r.sent_to} (secours).`)}>
              <Send className="h-4 w-4" /> Secours
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
