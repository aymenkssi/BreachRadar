import { useState } from "react";
import { toast } from "sonner";
import { Layers3, Upload, Loader2, Play, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { investigateBatch } from "@/lib/api";
import { scoreColor, riskInfo } from "@/lib/format";

export const BatchDialog = ({ onSelect, onDone }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  const parseTargets = (raw) =>
    raw.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText((prev) => (prev ? prev + "\n" : "") + reader.result);
    reader.readAsText(file);
  };

  const run = async () => {
    const targets = parseTargets(text);
    if (targets.length === 0) return toast.error("Ajoutez au moins une cible.");
    setLoading(true);
    setResults([]);
    try {
      const data = await investigateBatch(targets);
      setResults(data);
      toast.success(`${data.length} cible(s) analysée(s).`);
      onDone?.();
    } catch {
      toast.error("Échec de l'analyse par lot.");
    } finally {
      setLoading(false);
    }
  };

  const pick = (inv) => {
    onSelect(inv);
    setOpen(false);
  };

  const count = parseTargets(text).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="batch-open-btn" className="gap-2">
          <Layers3 className="h-4 w-4" /> Analyse par lot
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-primary" /> Analyse par lot
          </DialogTitle>
          <DialogDescription>
            Collez ou importez une liste d'emails / domaines (un par ligne ou séparés par des virgules). Maximum 15 cibles.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            data-testid="batch-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"adobe.com\ntest@example.com\nlinkedin.com"}
            className="min-h-[130px] font-mono-x text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
              <Upload className="h-4 w-4" /> Importer un fichier
              <input data-testid="batch-file-input" type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
            </label>
            <span className="font-mono-x text-xs text-muted-foreground">{count} cible(s)</span>
            <Button data-testid="batch-run-btn" onClick={run} disabled={loading || count === 0} className="gap-2">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyse…</> : <><Play className="h-4 w-4" /> Lancer</>}
            </Button>
          </div>
        </div>

        {results.length > 0 && (
          <div data-testid="batch-results" className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {results.map((r) => {
              const info = riskInfo(r.risk_label);
              return (
                <button
                  key={r.id}
                  data-testid={`batch-result-${r.target}`}
                  onClick={() => pick(r)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg font-mono-x text-sm font-bold" style={{ color: scoreColor(r.score), background: `${scoreColor(r.score)}1a` }}>
                    {r.score}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono-x text-sm font-medium text-foreground">{r.target}</div>
                    <div className="text-xs text-muted-foreground">
                      <span style={{ color: info.color }}>{info.label}</span> · {r.total_breaches} fuite(s)
                    </div>
                  </div>
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              );
            })}
            <p className="pt-1 text-center text-xs text-muted-foreground">Cliquez sur une cible pour ouvrir le détail et générer le rapport IA.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
