import { KeyRound, CreditCard, UserRound, Mail, MapPin, MonitorSmartphone, Briefcase, Boxes, PieChart } from "lucide-react";
import { SEVERITY } from "@/lib/format";

const ICONS = {
  "Identifiants & Sécurité": KeyRound,
  "Finances": CreditCard,
  "Identité personnelle": UserRound,
  "Contact & Communication": Mail,
  "Adresse & Localisation": MapPin,
  "Appareil & Réseau": MonitorSmartphone,
  "Emploi & Éducation": Briefcase,
  "Autres données": Boxes,
};

export const DataCategoryMap = ({ categories, totalBreaches, activeCategory, onSelect }) => {
  if (!categories?.length) return null;
  const max = Math.max(...categories.map((c) => c.count), 1);

  return (
    <div data-testid="data-category-map" className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
          <PieChart className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-heading text-base font-semibold leading-tight">Carte des données exposées</h3>
          <p className="text-xs font-mono-x text-muted-foreground">Cliquez pour filtrer le tableau · {categories.length} catégorie(s)</p>
        </div>
      </div>

      <div className="space-y-3">
        {categories.map((cat) => {
          const sev = SEVERITY[cat.severity] || SEVERITY.low;
          const Icon = ICONS[cat.category] || Boxes;
          const pct = Math.round((cat.count / max) * 100);
          const active = activeCategory === cat.category;
          return (
            <button
              type="button"
              key={cat.category}
              data-testid={`category-${cat.category}`}
              onClick={() => onSelect?.(active ? null : cat.category)}
              className={`group w-full rounded-xl border p-3 text-left transition-all ${
                active ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "border-transparent hover:border-border hover:bg-secondary/40"
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${sev.text}`} />
                  <span className="font-heading text-sm font-semibold text-foreground">{cat.category}</span>
                </div>
                <span className={`font-mono-x text-xs font-semibold ${sev.text}`}>
                  {cat.count}/{totalBreaches} fuites
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${sev.dot} transition-all duration-700`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {cat.items.slice(0, 6).map((it) => (
                  <span key={it.name} className="rounded-md border border-border bg-background/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {it.name}
                    <span className="ml-1 text-muted-foreground/60">×{it.count}</span>
                  </span>
                ))}
                {cat.items.length > 6 && (
                  <span className="px-1 text-[11px] font-mono-x text-muted-foreground">+{cat.items.length - 6}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
