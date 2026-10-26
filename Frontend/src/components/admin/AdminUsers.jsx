import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Loader2, RefreshCw, Search, Trash2, XCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, errorMessage } from "@/lib/api";
import { fmtDate } from "@/components/admin/common";

const STATUS_LABEL = { ACTIVE: "actif", CANCELLED: "résilié", SUSPENDED: "paiement en échec", EXPIRED: "terminé", PENDING: "en attente" };
const PROVIDER = { stripe: "Stripe", paypal: "PayPal" };

const inOneMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

const UserRow = ({ u, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const [grant, setGrant] = useState(null);
  const run = async (name, fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    try {
      const updated = await fn();
      onChanged(updated?.id ? updated : null, u.id);
      toast.success("Modification enregistrée.");
    } catch (err) {
      toast.error(errorMessage(err, "Action impossible."));
    } finally {
      setBusy(null);
    }
  };
  const sub = u.subscription;
  const icon = (name, Icon) => (busy === name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />);
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2.5 pr-3">
        <p className="font-mono-x text-xs">{u.email}</p>
        <p className="text-[11px] text-muted-foreground">
          {u.email_verified ? "confirmé" : "non confirmé"}{u.is_admin && " · admin"} · {u.monitors} adresse(s)
        </p>
      </td>
      <td className="py-2.5 pr-3 text-xs">
        {u.premium ? <span className="font-semibold text-primary">Premium</span> : <span className="text-muted-foreground">Gratuit</span>}
        {u.premium_until && <p className="text-[11px] text-muted-foreground">jusqu'au {fmtDate(u.premium_until)}</p>}
        {u.manual_premium && <p className="text-[11px] text-muted-foreground">offert par {u.manual_premium.by}</p>}
      </td>
      <td className="py-2.5 pr-3 text-xs">
        {sub ? <>
          {PROVIDER[sub.provider] || sub.provider} · {sub.plan === "yearly" ? "annuel" : sub.plan === "monthly" ? "mensuel" : "?"}
          <p className={`text-[11px] ${sub.status === "SUSPENDED" ? "text-red-500" : "text-muted-foreground"}`}>{STATUS_LABEL[sub.status] || sub.status}</p>
        </> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2.5 pr-3 text-[11px] text-muted-foreground">
        créé {fmtDate(u.created_at)}<br />connecté {fmtDate(u.last_login_at)}
      </td>
      <td className="py-2.5">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setGrant(grant ? null : inOneMonth())}>
            {icon("grant", Gift)} Offrir
          </Button>
          {u.premium && (
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              onClick={() => run("revoke", () => admin.revokePremium(u.id), `Retirer l'accès Premium de ${u.email} ? (l'abonnement payant n'est pas résilié)`)}>
              {icon("revoke", Ban)} Retirer
            </Button>
          )}
          {sub && ["ACTIVE", "SUSPENDED"].includes(sub.status) && (
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              onClick={() => run("cancel", () => admin.cancelSubscription(u.id), `Résilier l'abonnement de ${u.email} chez ${PROVIDER[sub.provider]} ?`)}>
              {icon("cancel", XCircle)} Résilier
            </Button>
          )}
          {u.subscription_id && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" title="Relire le statut chez le fournisseur"
              onClick={() => run("sync", () => admin.syncSubscription(u.id))}>
              {icon("sync", RefreshCw)}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-red-500" title="Supprimer le compte"
            onClick={() => run("delete", () => admin.deleteUser(u.id), `Supprimer définitivement le compte ${u.email} et ses données ?`)}>
            {icon("delete", Trash2)}
          </Button>
        </div>
        {grant !== null && (
          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); run("grant", () => admin.grantPremium(u.id, grant, "")); setGrant(null); }}>
            <Input type="date" required value={grant} onChange={(e) => setGrant(e.target.value)} className="h-7 w-40 text-xs" />
            <Button size="sm" type="submit" className="h-7 px-2 text-xs">Offrir jusqu'au</Button>
          </form>
        )}
      </td>
    </tr>
  );
};

export const AdminUsers = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try { setData(await admin.users({ q, status, page })); } catch (err) { toast.error(errorMessage(err, "Chargement impossible.")); }
  }, [q, status, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const onChanged = (updated, id) => setData((d) => ({
    ...d,
    total: updated ? d.total : d.total - 1,
    users: updated ? d.users.map((x) => (x.id === id ? updated : x)) : d.users.filter((x) => x.id !== id),
  }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Rechercher une adresse…" className="pl-9" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border border-border bg-background px-3 text-sm">
          <option value="all">Tous</option>
          <option value="premium">Premium</option>
          <option value="free">Gratuits</option>
          <option value="suspended">Paiement en échec</option>
        </select>
      </div>
      {!data ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
        <>
          <p className="text-xs text-muted-foreground">{data.total} compte(s)</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">
                <tr><th className="pb-2">Compte</th><th className="pb-2">Accès</th><th className="pb-2">Abonnement</th><th className="pb-2">Activité</th><th className="pb-2">Actions</th></tr>
              </thead>
              <tbody>{data.users.map((u) => <UserRow key={u.id} u={u} onChanged={onChanged} />)}</tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              {page} / {pages}
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
