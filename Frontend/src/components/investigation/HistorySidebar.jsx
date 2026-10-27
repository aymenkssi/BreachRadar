import { History, Trash2, RotateCcw, X, ShieldQuestion } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { riskInfo, scoreColor } from "@/lib/format";

export const HistorySidebar = ({ history, onSelect, onDelete, onClear }) => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" data-testid="history-open-btn" className="gap-2" aria-label="Historique">
          <History className="h-4 w-4" /> <span className="hidden sm:inline">Historique</span>
          {history.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-mono-x text-primary">{history.length}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full border-border bg-card sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-heading flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Historique des investigations
          </SheetTitle>
          <SheetDescription>Vos investigations passées, avec score et nombre de fuites.</SheetDescription>
        </SheetHeader>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldQuestion className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aucune investigation enregistrée pour le moment.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button variant="ghost" size="sm" data-testid="clear-history-btn" onClick={onClear} className="gap-1.5 text-muted-foreground hover:text-red-500">
                <Trash2 className="h-4 w-4" /> Tout effacer
              </Button>
            </div>
            <div data-testid="investigation-history-list" className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 160px)" }}>
              {history.map((h) => {
                const info = riskInfo(h.risk_label);
                return (
                  <div
                    key={h.id}
                    data-testid={`history-item-${h.id}`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg font-mono-x text-sm font-bold" style={{ color: scoreColor(h.score), background: `${scoreColor(h.score)}1a` }}>
                      {h.score}
                    </div>
                    <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(h)}>
                      <div className="truncate font-mono-x text-sm font-medium text-foreground">{h.target}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span style={{ color: info.color }}>{info.label}</span>
                        <span>·</span>
                        <span>{h.total_breaches} fuite(s)</span>
                      </div>
                    </button>
                    <button data-testid={`history-reload-${h.id}`} onClick={() => onSelect(h)} className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button data-testid={`history-delete-${h.id}`} onClick={() => onDelete(h.id)} className="text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">
                      <X className="h-4 w-4" />
                    </button>
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
