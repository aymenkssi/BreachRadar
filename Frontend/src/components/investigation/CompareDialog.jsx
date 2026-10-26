import { useState } from "react";
import { GitCompare, X, Database, KeyRound, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { scoreColor, riskInfo, formatNumber } from "@/lib/format";

export const CompareDialog = ({ history }) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);

  const uniqueHistory = [];
  const seenTargets = new Set();
  for (const h of history) {
    const k = h.target.toLowerCase();
    if (!seenTargets.has(k)) { seenTargets.add(k); uniqueHistory.push(h); }
  }

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));

  const items = uniqueHistory.filter((h) => selected.includes(h.id));

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected([]); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="compare-open-btn" className="gap-2" disabled={uniqueHistory.length < 2}>
          <GitCompare className="h-4 w-4" /> Comparer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" /> Comparaison de cibles
          </DialogTitle>
          <DialogDescription>Sélectionnez de 2 à 4 investigations pour comparer leurs scores et expositions.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" data-testid="compare-selector">
          {uniqueHistory.map((h) => {
            const active = selected.includes(h.id);
            const disabled = !active && selected.length >= 4;
            return (
              <button
                key={h.id}
                data-testid={`compare-select-${h.target}`}
                onClick={() => toggle(h.id)}
                disabled={disabled}
                className={`rounded-full border px-3 py-1.5 font-mono-x text-xs transition-colors ${
                  active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                } ${disabled ? "opacity-40" : ""}`}
              >
                {h.target}
              </button>
            );
          })}
        </div>

        {items.length >= 2 ? (
          <div data-testid="compare-grid" className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((h) => {
              const info = riskInfo(h.risk_label);
              const topCats = (h.data_categories || []).slice(0, 3);
              return (
                <div key={h.id} className="rounded-xl border border-border bg-background/50 p-4">
                  <div className="mb-3 truncate font-mono-x text-sm font-medium text-foreground" title={h.target}>{h.target}</div>
                  <div className="mb-3 flex flex-col items-center">
                    <div className="font-mono-x text-4xl font-extrabold" style={{ color: scoreColor(h.score) }}>{h.score}</div>
                    <span className="text-xs font-semibold" style={{ color: info.color }}>{info.label}</span>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${h.score}%`, background: scoreColor(h.score) }} />
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Fuites</span><span className="font-mono-x text-foreground">{h.total_breaches}</span></div>
                    <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Enreg.</span><span className="font-mono-x text-foreground">{formatNumber(h.total_records)}</span></div>
                    <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> MDP</span><span className={`font-mono-x ${h.exposed_passwords ? "text-red-500" : "text-emerald-500"}`}>{h.exposed_passwords ? "Exposés" : "Aucun"}</span></div>
                  </div>
                  {topCats.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {topCats.map((c) => (
                        <span key={c.category} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{c.category}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <GitCompare className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Sélectionnez au moins 2 cibles ci-dessus.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
