import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const fmtDate = (iso, withTime = false) =>
  iso ? new Date(iso).toLocaleString("fr-FR", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export const Card = ({ title, children, className = "" }) => (
  <div className={`rounded-2xl border border-border bg-card/80 p-5 ${className}`}>
    {title && <h3 className="mb-4 font-heading font-semibold">{title}</h3>}
    {children}
  </div>
);

export const Field = ({ label, hint, id, ...props }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} {...props} />
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

// Secret en écriture seule : vide = conserver la valeur enregistrée
export const SecretField = ({ label, id, isSet, value, onChange, onClear, cleared }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type="password" autoComplete="new-password" value={value} onChange={onChange}
      placeholder={cleared ? "sera supprimé" : isSet ? "•••••••• (enregistré, laisser vide pour conserver)" : "non défini"} />
    {isSet && !cleared && (
      <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-red-500">Effacer la valeur enregistrée</button>
    )}
  </div>
);

export const Badge = ({ ok, children }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>
    {children}
  </span>
);

export const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
  </label>
);
