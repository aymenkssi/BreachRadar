import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, errorMessage } from "@/lib/api";
import { Card, Field, Toggle, fmtDate } from "@/components/admin/common";

const EMPTY = { code: "", kind: "percent", value: "20", duration: "once", duration_months: "3", days: "30",
  monthly: true, yearly: true, max_redemptions: "", expires_at: "", note: "" };

const Select = ({ id, label, value, onChange, children }) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <select id={id} value={value} onChange={onChange} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm">
      {children}
    </select>
  </div>
);

const Redemptions = ({ promo }) => {
  const [rows, setRows] = useState(null);
  useEffect(() => { admin.promoRedemptions(promo.id).then(setRows).catch(() => setRows([])); }, [promo.id]);
  if (!rows) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!rows.length) return <p className="text-xs text-muted-foreground">Aucune utilisation.</p>;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {rows.map((r) => <li key={r.user_id}>{fmtDate(r.at, true)} · {r.email} · {r.provider === "free" ? "accès offert" : r.provider}</li>)}
    </ul>
  );
};

export const AdminPromos = () => {
  const [promos, setPromos] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const load = () => admin.promos().then(setPromos).catch((err) => toast.error(errorMessage(err, "Chargement impossible.")));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const free = form.kind === "free";

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await admin.createPromo({
        code: form.code, kind: form.kind, value: free ? 0 : Number(String(form.value).replace(",", ".")),
        duration: form.duration, duration_months: form.duration === "repeating" ? Number(form.duration_months) : null,
        days: free ? Number(form.days) : null, plans: ["monthly", "yearly"].filter((k) => form[k]),
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        expires_at: form.expires_at || null, note: form.note,
      });
      toast.success(`Code ${p.code} créé.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(Array.isArray(detail) ? detail[0]?.msg?.replace(/^Value error, /, "") : errorMessage(err, "Création impossible."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p) => {
    try { await admin.setPromoActive(p.id, !p.active); load(); } catch (err) { toast.error(errorMessage(err, "Action impossible.")); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Supprimer le code ${p.code} ? Il ne pourra plus être utilisé (les abonnements déjà réduits ne changent pas).`)) return;
    try { await admin.deletePromo(p.id); load(); } catch (err) { toast.error(errorMessage(err, "Suppression impossible.")); }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={create}>
        <Card title="Nouveau code promo">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="pcode" label="Code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="Vide = généré automatiquement" hint="Lettres, chiffres, - et _" />
            <Select id="pkind" label="Type" value={form.kind} onChange={set("kind")}>
              <option value="percent">Réduction en %</option>
              <option value="amount">Réduction en €</option>
              <option value="free">Accès offert (sans paiement)</option>
            </Select>
            {free ? (
              <Field id="pdays" label="Jours offerts" type="number" min={1} value={form.days} onChange={set("days")} required />
            ) : (
              <Field id="pvalue" label={form.kind === "percent" ? "Réduction (%)" : "Réduction (€)"} value={form.value}
                onChange={set("value")} required />
            )}
            {!free && (
              <Select id="pduration" label="Durée de la réduction" value={form.duration} onChange={set("duration")}>
                <option value="once">Première échéance</option>
                <option value="repeating">Pendant N mois</option>
                <option value="forever">Toute la durée</option>
              </Select>
            )}
            {!free && form.duration === "repeating" && (
              <Field id="pmonths" label="Nombre de mois" type="number" min={1} max={36} value={form.duration_months} onChange={set("duration_months")} />
            )}
            <Field id="pmax" label="Utilisations max." type="number" min={1} value={form.max_redemptions} onChange={set("max_redemptions")}
              placeholder="Illimité" />
            <Field id="pexp" label="Expire le" type="date" value={form.expires_at} onChange={set("expires_at")} hint="Facultatif" />
            <Field id="pnote" label="Note interne" value={form.note} onChange={set("note")} placeholder="Ex. partenariat X" />
          </div>
          {!free && (
            <div className="mt-4 flex flex-wrap gap-4">
              <Toggle checked={form.monthly} onChange={set("monthly")} label="Formule mensuelle" />
              <Toggle checked={form.yearly} onChange={set("yearly")} label="Formule annuelle" />
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {free ? "Le client active l'accès depuis le champ « Code promo », sans paiement."
              : form.duration === "forever" ? "Utilisable par carte (Stripe) et PayPal (avec PayPal, le prix réduit doit rester ≥ 0,50 €)."
                : "Utilisable par carte (Stripe) et PayPal (période d'essai au prix réduit, gratuite à 100 %, puis tarif normal)."}
            {" "}Un compte ne peut utiliser un code qu'une fois.
          </p>
          <Button type="submit" disabled={busy} className="mt-4 gap-2" data-testid="promo-create-btn">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer le code
          </Button>
        </Card>
      </form>

      <Card title="Codes existants">
        {!promos ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : promos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun code pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="promo-list">
              <thead className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">
                <tr><th className="pb-2">Code</th><th className="pb-2">Avantage</th><th className="pb-2">Utilisations</th><th className="pb-2">Expiration</th><th className="pb-2">Actif</th><th /></tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-t border-border align-top">
                      <td className="py-2.5 pr-3">
                        <button type="button" className="flex items-center gap-1.5 font-mono-x text-xs" title="Copier"
                          onClick={() => { navigator.clipboard?.writeText(p.code); toast.success("Code copié."); }}>
                          {p.code} <Copy className="h-3 w-3 text-muted-foreground" />
                        </button>
                        {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {p.description}
                        {p.kind !== "free" && p.plans.length === 1 && <p className="text-[11px] text-muted-foreground">formule {p.plans[0] === "monthly" ? "mensuelle" : "annuelle"} seulement</p>}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        <button type="button" className="flex items-center gap-1 hover:text-primary" onClick={() => setOpen(open === p.id ? null : p.id)}>
                          <Users className="h-3.5 w-3.5" /> {p.redemptions}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 text-xs">{p.expires_at ? fmtDate(p.expires_at) : "—"}</td>
                      <td className="py-2.5 pr-3"><input type="checkbox" checked={p.active} onChange={() => toggle(p)} aria-label="Actif" /></td>
                      <td className="py-2.5 text-right">
                        <button type="button" onClick={() => remove(p)} className="text-muted-foreground hover:text-red-500" aria-label="Supprimer">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                    {open === p.id && (
                      <tr><td colSpan={6} className="pb-3"><Redemptions promo={p} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
