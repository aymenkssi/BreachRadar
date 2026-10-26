import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { admin, errorMessage } from "@/lib/api";
import { Card, Field } from "@/components/admin/common";

const FIELDS = [
  ["company_name", "Nom ou raison sociale", "Ex. Dupont Jean (EI) ou BreachRadar SAS"],
  ["legal_form", "Forme juridique", "Ex. entreprise individuelle, SAS, SARL"],
  ["capital", "Capital social", "Sociétés uniquement, ex. 1 000 €"],
  ["address", "Adresse du siège", ""],
  ["siret", "SIRET", ""],
  ["rcs", "RCS / RNE", "Ex. RCS Paris 123 456 789"],
  ["vat_number", "N° de TVA intracommunautaire", "Laisser vide si non assujetti"],
  ["contact_email", "E-mail de contact", "Réclamations, rétractation, droits RGPD"],
  ["phone", "Téléphone", "Facultatif"],
  ["publication_director", "Directeur de la publication", ""],
  ["host_name", "Hébergeur", "Ex. OVH SAS"],
  ["host_address", "Adresse de l'hébergeur", "Ex. 2 rue Kellermann, 59100 Roubaix"],
  ["host_phone", "Téléphone de l'hébergeur", ""],
  ["mediator_name", "Médiateur de la consommation", "Obligatoire pour vendre aux particuliers"],
  ["mediator_url", "Site du médiateur", "https://…"],
];

export const AdminLegal = () => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { admin.legal().then(setForm).catch((err) => toast.error(errorMessage(err, "Chargement impossible."))); }, []);
  if (!form) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { setForm(await admin.saveLegal(form)); toast.success("Informations légales enregistrées."); }
    catch (err) { toast.error(errorMessage(err, "Enregistrement impossible.")); }
    finally { setSaving(false); }
  };
  const missing = FIELDS.filter(([k]) => !["capital", "vat_number", "phone", "host_phone", "rcs"].includes(k) && !form[k]).length;
  return (
    <form onSubmit={save}>
      <Card title="Informations affichées sur les pages légales">
        <p className="mb-4 text-xs text-muted-foreground">
          Reprises dans les <Link to="/mentions-legales" target="_blank" className="text-primary">mentions légales</Link>,
          les <Link to="/cgv" target="_blank" className="text-primary">CGV</Link> et la{" "}
          <Link to="/confidentialite" target="_blank" className="text-primary">politique de confidentialité</Link>.
          {missing > 0 && <span className="text-amber-500"> {missing} information(s) obligatoire(s) manquante(s).</span>}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(([k, label, hint]) => (
            <Field key={k} id={k} label={label} hint={hint} value={form[k] || ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          ))}
        </div>
        <Button type="submit" disabled={saving} className="mt-4 gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
        </Button>
      </Card>
    </form>
  );
};

export const AdminAudit = () => {
  const [rows, setRows] = useState(null);
  useEffect(() => { admin.audit().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  return (
    <Card title="Journal d'administration (200 dernières actions)">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
                  <td className="py-2 pr-3 font-mono-x">{r.action}</td>
                  <td className="py-2 pr-3">{r.admin}</td>
                  <td className="py-2 text-muted-foreground">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
