import { useState } from "react";
import { toast } from "sonner";
import { Bell, BellRing, Loader2, RefreshCw, Trash2, ShieldQuestion, Check, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { scoreColor, riskInfo } from "@/lib/format";
import { checkWatch, checkAllWatches, markWatchSeen, deleteWatch } from "@/lib/api";

export const WatchlistSheet = ({ watchlist, onChange }) => {
  const [busy, setBusy] = useState(null);
  const alerts = watchlist.filter((w) => w.has_new).length;

  const doCheck = async (id) => {
    setBusy(id);
    try {
      const w = await checkWatch(id);
      if (w.has_new) toast.warning(`${w.new_breaches.length} nouvelle(s) fuite(s) pour ${w.target} !`);
      else toast.success(`Aucune nouvelle fuite pour ${w.target}.`);
      await onChange();
    } catch { toast.error("Échec de la vérification."); }
    finally { setBusy(null); }
  };

  const doCheckAll = async () => {
    setBusy("all");
    try {
      const list = await checkAllWatches();
      const n = list.filter((w) => w.has_new).length;
      toast[n ? "warning" : "success"](n ? `${n} cible(s) avec de nouvelles fuites !` : "Aucune nouvelle fuite détectée.");
      await onChange();
    } catch { toast.error("Échec de la vérification."); }
    finally { setBusy(null); }
  };

  const doSeen = async (id) => { await markWatchSeen(id); onChange(); };
  const doDelete = async (id) => { await deleteWatch(id); onChange(); };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" data-testid="watchlist-open-btn" className="relative">
          {alerts > 0 ? <BellRing className="h-4 w-4 text-primary" /> : <Bell className="h-4 w-4" />}
          {alerts > 0 && (
            <span data-testid="watchlist-alert-count" className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {alerts}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full border-border bg-card sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-heading flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> Alertes de surveillance
          </SheetTitle>
          <SheetDescription>Suivez des cibles et détectez toute nouvelle fuite qui les concerne.</SheetDescription>
        </SheetHeader>

        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldQuestion className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aucune cible surveillée. Lancez une investigation puis cliquez sur « Surveiller ».</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button variant="outline" size="sm" data-testid="watchlist-check-all-btn" onClick={doCheckAll} disabled={busy === "all"} className="gap-1.5">
                {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Tout vérifier
              </Button>
            </div>
            <div data-testid="watchlist-list" className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 170px)" }}>
              {watchlist.map((w) => {
                const info = riskInfo(w.risk_label);
                return (
                  <div key={w.id} data-testid={`watch-item-${w.target}`} className={`rounded-xl border p-3 ${w.has_new ? "border-red-500/40 bg-red-500/5" : "border-border bg-background/50"}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg font-mono-x text-sm font-bold" style={{ color: scoreColor(w.score), background: `${scoreColor(w.score)}1a` }}>
                        {w.score}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono-x text-sm font-medium text-foreground">{w.target}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span style={{ color: info.color }}>{info.label}</span>
                          <span>·</span><span>{w.total_breaches} fuite(s)</span>
                        </div>
                      </div>
                      <button data-testid={`watch-check-${w.target}`} onClick={() => doCheck(w.id)} disabled={busy === w.id} className="text-muted-foreground hover:text-primary disabled:opacity-50">
                        {busy === w.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </button>
                      <button data-testid={`watch-delete-${w.target}`} onClick={() => doDelete(w.id)} className="text-muted-foreground hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {w.has_new && (
                      <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-500">
                          <AlertTriangle className="h-3.5 w-3.5" /> {w.new_breaches.length} nouvelle(s) fuite(s)
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {w.new_breaches.slice(0, 8).map((n) => (
                            <span key={n} className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-mono-x text-red-500">{n}</span>
                          ))}
                        </div>
                        <button data-testid={`watch-seen-${w.target}`} onClick={() => doSeen(w.id)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                          <Check className="h-3 w-3" /> Marquer comme lu
                        </button>
                      </div>
                    )}
                    <p className="mt-1.5 text-[10px] font-mono-x text-muted-foreground">Vérifié : {new Date(w.last_checked).toLocaleString("fr-FR")}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
