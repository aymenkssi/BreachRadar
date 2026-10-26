import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, errorMessage } from "@/lib/api";
import { Badge, Card, Field, SecretField, Toggle, fmtDate } from "@/components/admin/common";

const SECRETS = ["paypal_secret", "stripe_secret_key", "stripe_webhook_secret"];

const WebhookUrl = ({ url, help }) => (
  <div className="space-y-1">
    <p className="text-xs text-muted-foreground">{help}</p>
    <div className="flex gap-2">
      <Input readOnly value={url} className="font-mono-x text-xs" />
      <Button type="button" size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url); toast.success("Copié."); }}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  </div>
);

const CreatePlans = ({ provider, onDone }) => {
  const [monthly, setMonthly] = useState("4.99");
  const [yearly, setYearly] = useState("49.99");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!window.confirm(`Créer chez ${provider === "stripe" ? "Stripe" : "PayPal"} les formules ${monthly} €/mois et ${yearly} €/an ?`)) return;
    setBusy(true);
    try { onDone(await admin.createPlans(provider, monthly, yearly)); toast.success("Formules créées et enregistrées."); }
    catch (err) { toast.error(errorMessage(err, "Création impossible.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <p className="mb-2 text-xs text-muted-foreground">Créer automatiquement les deux formules (prix TTC en euros) :</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input value={monthly} onChange={(e) => setMonthly(e.target.value)} className="h-8 w-24" /> €/mois
        <Input value={yearly} onChange={(e) => setYearly(e.target.value)} className="h-8 w-24" /> €/an
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={create} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Créer les formules
        </Button>
      </div>
    </div>
  );
};

export const AdminPayments = () => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = (d) => {
    setData(d);
    setForm({ ...d, ...Object.fromEntries(SECRETS.flatMap((s) => [[s, ""], [`clear_${s}`, false]])) });
  };
  useEffect(() => { admin.payments().then(load).catch((err) => toast.error(errorMessage(err, "Chargement impossible."))); }, []);
  if (!form) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = Object.fromEntries(Object.entries(form).filter(([k]) =>
      ["price_monthly_label", "price_yearly_label", "paypal_enabled", "paypal_mode", "paypal_client_id", "paypal_webhook_id",
        "paypal_plan_monthly", "paypal_plan_yearly", "stripe_enabled", "stripe_price_monthly", "stripe_price_yearly",
        ...SECRETS, ...SECRETS.map((s) => `clear_${s}`)].includes(k)));
    SECRETS.forEach((s) => { if (!body[s]) body[s] = null; });
    try { load(await admin.savePayments(body)); toast.success("Moyens de paiement enregistrés."); }
    catch (err) { toast.error(errorMessage(err, "Enregistrement impossible.")); }
    finally { setSaving(false); }
  };
  const secret = (name, label) => (
    <SecretField id={name} label={label} isSet={data[`${name}_set`]} value={form[name]} onChange={set(name)}
      cleared={form[`clear_${name}`]} onClear={() => setForm((f) => ({ ...f, [`clear_${name}`]: true, [name]: "" }))} />
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Prix affichés">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pm" label="Formule mensuelle" value={form.price_monthly_label} onChange={set("price_monthly_label")} required />
          <Field id="py" label="Formule annuelle" value={form.price_yearly_label} onChange={set("price_yearly_label")} required />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Doivent correspondre aux prix réels des formules PayPal / Stripe (repris dans les CGV).</p>
      </Card>

      <Card title={<span className="flex items-center gap-2">Stripe (carte bancaire) <Badge ok={data.stripe_ready}>{data.stripe_ready ? "opérationnel" : "incomplet"}</Badge>
        {data.stripe_secret_key_mode && <Badge ok={data.stripe_secret_key_mode === "live"}>clé {data.stripe_secret_key_mode === "live" ? "de production" : "de test"}</Badge>}</span>}>
        <div className="space-y-4">
          <Toggle checked={form.stripe_enabled} onChange={set("stripe_enabled")} label="Proposer le paiement par carte (Stripe)" />
          <div className="grid gap-4 sm:grid-cols-2">
            {secret("stripe_secret_key", "Clé secrète (sk_live_… ou sk_test_…)")}
            {secret("stripe_webhook_secret", "Secret du webhook (whsec_…)")}
            <Field id="spm" label="ID du tarif mensuel (price_…)" value={form.stripe_price_monthly} onChange={set("stripe_price_monthly")} />
            <Field id="spy" label="ID du tarif annuel (price_…)" value={form.stripe_price_yearly} onChange={set("stripe_price_yearly")} />
          </div>
          <CreatePlans provider="stripe" onDone={load} />
          <WebhookUrl url={data.stripe_webhook_url}
            help="Stripe → Développeurs → Webhooks : ajouter cette URL avec les événements customer.subscription.* et invoice.paid / invoice.payment_failed." />
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2">PayPal <Badge ok={data.paypal_ready}>{data.paypal_ready ? "opérationnel" : "incomplet"}</Badge></span>}>
        <div className="space-y-4">
          <Toggle checked={form.paypal_enabled} onChange={set("paypal_enabled")} label="Proposer le paiement PayPal" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="ppmode">Mode</label>
              <select id="ppmode" value={form.paypal_mode} onChange={set("paypal_mode")} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
                <option value="sandbox">Sandbox (essais)</option>
                <option value="live">Live (production)</option>
              </select>
            </div>
            <Field id="ppid" label="Client ID" value={form.paypal_client_id} onChange={set("paypal_client_id")} />
            {secret("paypal_secret", "Secret")}
            <Field id="ppwh" label="ID du webhook" value={form.paypal_webhook_id} onChange={set("paypal_webhook_id")} />
            <Field id="pppm" label="ID du plan mensuel (P-…)" value={form.paypal_plan_monthly} onChange={set("paypal_plan_monthly")} />
            <Field id="pppy" label="ID du plan annuel (P-…)" value={form.paypal_plan_yearly} onChange={set("paypal_plan_yearly")} />
          </div>
          <CreatePlans provider="paypal" onDone={load} />
          <WebhookUrl url={data.paypal_webhook_url}
            help="PayPal Developer → votre application → Webhooks : ajouter cette URL (événements BILLING.SUBSCRIPTION.* et PAYMENT.SALE.COMPLETED), puis recopier son ID ci-dessus." />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
        </Button>
        <p className="text-xs text-muted-foreground">
          {data.source === "env" ? "Valeurs actuelles issues du fichier .env." : `Modifié le ${fmtDate(data.updated_at, true)} par ${data.updated_by}.`}
          {" "}Les secrets sont chiffrés et ne sont jamais réaffichés.
        </p>
      </div>
    </form>
  );
};
