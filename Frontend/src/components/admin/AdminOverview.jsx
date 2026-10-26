import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { admin } from "@/lib/api";
import { Card } from "@/components/admin/common";
import { EmailQuota } from "@/components/admin/AdminSmtp";

const Stat = ({ label, value, sub }) => (
  <div className="rounded-xl border border-border bg-background/50 p-4">
    <p className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="mt-1 font-heading text-2xl font-bold">{value}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

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
    </div>
  );
};
