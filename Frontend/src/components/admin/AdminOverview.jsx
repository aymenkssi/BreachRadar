import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { admin, errorMessage } from "@/lib/api";
import { Card, Field } from "@/components/admin/common";
import { EmailQuota } from "@/components/admin/AdminSmtp";

const Stat = ({ label, value, sub }) => (
  <div className="rounded-xl border border-border bg-background/50 p-4">
    <p className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="mt-1 font-heading text-2xl font-bold">{value}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

// Carte « Adresses surveillées » de la page d'accueil : compteur réel, valeur saisie ou masquée
const StatsDisplay = () => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { admin.statsDisplay().then(setForm).catch(() => setForm(false)); }, []);
  if (form === null) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!form) return <p className="text-sm text-red-500">Chargement impossible.</p>;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setForm(await admin.saveStatsDisplay({ mode: form.mode, value: Number(form.value) || 0, label: form.label, sub: form.sub }));
      toast.success("Carte de la page d'accueil mise à jour.");
    } catch (err) {
      toast.error(errorMessage(err, "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-4" data-testid="stats-display-form">
      <div className="flex flex-wrap gap-4 text-sm">
        {[["auto", "Compteur réel"], ["manual", "Valeur saisie"], ["hidden", "Masquer la carte"]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="stats-mode" value={k} checked={form.mode === k} onChange={set("mode")} /> {label}
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="smv" label="Valeur affichée" type="number" min={0} value={form.value} onChange={set("value")}
          disabled={form.mode !== "manual"} hint={`Compteur réel : ${form.real_value} adresse(s) vérifiée(s)`} />
        <Field id="sml" label="Titre de la carte" value={form.label} onChange={set("label")} required maxLength={40} />
        <Field id="sms" label="Texte sous le chiffre" value={form.sub} onChange={set("sub")} maxLength={80} />
      </div>
      {form.mode === "manual" && (
        <p className="text-xs text-amber-500">
          Le chiffre affiché doit être exact et vérifiable : un chiffre gonflé constitue une pratique commerciale
          trompeuse (art. L121-2 du Code de la consommation). Adaptez le titre à ce que vous comptez réellement.
        </p>
      )}
      <Button type="submit" disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
      </Button>
    </form>
  );
};

export const AdminOverview = () => {
  const [data, setData] = useState(null);
  useEffect(() => { admin.overview().then(setData).catch(() => setData(false)); }, []);
  if (data === null) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  if (!data) return <p className="text-sm text-red-500">Chargement impossible.</p>;
  const p = data.premium_by_provider;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Comptes confirmés" value={data.users} />
        <Stat label="Premium actifs" value={data.premium}
          sub={`Stripe ${p.stripe || 0} · PayPal ${p.paypal || 0} · offerts ${p.manuel || 0}`} />
        <Stat label="Abonnements payants" value={data.active_by_plan.monthly + data.active_by_plan.yearly}
          sub={`${data.active_by_plan.monthly} mensuels · ${data.active_by_plan.yearly} annuels`} />
        <Stat label="Adresses surveillées" value={data.monitors}
          sub={data.suspended ? `${data.suspended} paiement(s) en échec` : "aucun paiement en échec"} />
      </div>
      <Card title="E-mails envoyés aujourd'hui"><EmailQuota usage={data.emails} /></Card>
      <Card title="Page d'accueil : carte « Adresses surveillées »"><StatsDisplay /></Card>
    </div>
  );
};
