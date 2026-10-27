import { useState } from "react";
import { ChevronDown, ShieldCheck, ExternalLink, Search, DatabaseZap, X } from "lucide-react";
import { SEVERITY, formatNumber, isSensitive, categorize } from "@/lib/format";

const FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "critical", label: "Critiques" },
  { key: "passwords", label: "Mots de passe" },
  { key: "verified", label: "Vérifiées" },
];

const DataBadge = ({ label }) => {
  const sensitive = isSensitive(label);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
        sensitive ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-secondary text-muted-foreground border border-border"
      }`}
    >
      {label}
    </span>
  );
};

const Row = ({ b }) => {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[b.severity] || SEVERITY.medium;
  return (
    <>
      <tr
        data-testid={`breach-row-${b.name}`}
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-b border-border/60 transition-colors hover:bg-secondary/50"
      >
        <td className="py-3 pl-4 pr-2">
          <div className="flex items-center gap-3">
            {b.logo ? (
              <img src={b.logo} alt="" className="h-8 w-8 rounded-md bg-white/5 object-contain p-0.5" onError={(e) => (e.target.style.display = "none")} />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary"><DatabaseZap className="h-4 w-4 text-muted-foreground" /></div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-heading text-sm font-semibold text-foreground">
                <span className="truncate">{b.title}</span>
                {b.verified && <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
              </div>
              {b.domain && <div className="truncate text-xs font-mono-x text-muted-foreground">{b.domain}</div>}
            </div>
          </div>
        </td>
        <td className="px-2 text-sm font-mono-x text-muted-foreground">{b.date || "—"}</td>
        <td className="px-2">
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {b.exposed_data.slice(0, 3).map((d) => <DataBadge key={d} label={d} />)}
            {b.exposed_data.length > 3 && (
              <span className="text-[11px] font-mono-x text-muted-foreground">+{b.exposed_data.length - 3}</span>
            )}
          </div>
        </td>
        <td className="px-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${sev.bg} ${sev.text} ${sev.border}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} /> {sev.label}
          </span>
        </td>
        <td className="pr-4 text-right">
          <ChevronDown className={`inline h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-background/40">
          <td colSpan={5} className="px-4 py-4">
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{b.description || "Aucune description disponible."}</p>
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono-x text-muted-foreground">
              <span><span className="text-foreground">{formatNumber(b.exposed_records)}</span> enregistrements</span>
              {b.industry && <span>Secteur : <span className="text-foreground">{b.industry}</span></span>}
              {b.password_risk && <span>Risque MDP : <span className="text-foreground">{b.password_risk}</span></span>}
              {b.reference && (
                <a href={b.reference} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Référence <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">{b.exposed_data.map((d) => <DataBadge key={d} label={d} />)}</div>
          </td>
        </tr>
      )}
    </>
  );
};

export const BreachTable = ({ breaches, categoryFilter, onClearCategory, initialFilter = "all" }) => {
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");

  const filtered = breaches
    .filter((b) => {
      if (filter === "critical") return b.severity === "critical";
      if (filter === "passwords") return b.exposed_data.some((d) => d.toLowerCase().includes("password"));
      if (filter === "verified") return b.verified;
      return true;
    })
    .filter((b) => !categoryFilter || b.exposed_data.some((d) => categorize(d) === categoryFilter))
    .filter((b) => b.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div data-testid="breach-results-table" className="flex h-full flex-col rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-xl">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-heading text-base font-semibold">Fuites de données détectées</h3>
          <p className="text-xs font-mono-x text-muted-foreground">{breaches.length} source(s) — données réelles XposedOrNot</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="breach-table-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer…"
            className="w-full rounded-lg border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50 sm:w-52"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            data-testid={`filter-${f.key}`}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {categoryFilter && (
        <div data-testid="category-filter-banner" className="flex items-center justify-between gap-2 border-b border-border bg-primary/5 px-5 py-2.5">
          <span className="text-xs text-muted-foreground">
            Filtré par catégorie : <span className="font-semibold text-primary">{categoryFilter}</span>
          </span>
          <button data-testid="clear-category-filter" onClick={onClearCategory} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Réinitialiser
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Aucune fuite ne correspond à ce filtre.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-mono-x uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 pl-4">Source</th>
                <th className="px-2">Date</th>
                <th className="px-2">Données exposées</th>
                <th className="px-2">Sévérité</th>
                <th className="pr-4" />
              </tr>
            </thead>
            <tbody>{filtered.map((b, i) => <Row key={`${b.name}-${i}`} b={b} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
};
