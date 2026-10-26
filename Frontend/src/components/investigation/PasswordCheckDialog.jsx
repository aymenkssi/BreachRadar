import { useState } from "react";
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, ShieldAlert, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { checkPassword } from "@/lib/api";
import { formatNumber } from "@/lib/format";

export const PasswordCheckDialog = () => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (e) => {
    e?.preventDefault();
    if (!value) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await checkPassword(value);
      setResult(data);
    } catch {
      setResult({ error: true });
    } finally {
      setLoading(false);
    }
  };

  const reset = (o) => {
    setOpen(o);
    if (!o) { setValue(""); setResult(null); setShow(false); }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="password-open-btn" className="gap-2">
          <KeyRound className="h-4 w-4" /> Vérif. mot de passe
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" /> Vérification de mot de passe
          </DialogTitle>
          <DialogDescription>
            Vérifiez si un mot de passe figure dans des fuites connues. Confidentiel : seul un préfixe haché (k-anonymat, SHA-1) est envoyé — jamais le mot de passe.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={run} className="space-y-3">
          <div className="relative">
            <input
              data-testid="password-input"
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Entrez un mot de passe à tester…"
              autoComplete="off"
              className="w-full rounded-xl border border-border bg-background/60 py-3 pl-4 pr-11 font-mono-x text-sm outline-none focus:border-primary/50"
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" data-testid="password-check-btn" disabled={loading || !value} className="w-full gap-2">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Vérification…</> : <><Search className="h-4 w-4" /> Vérifier</>}
          </Button>
        </form>

        {result && !result.error && (
          <div
            data-testid="password-result"
            className={`flex items-start gap-3 rounded-xl border p-4 ${
              result.pwned ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/10"
            }`}
          >
            {result.pwned ? <ShieldAlert className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-500" /> : <ShieldCheck className="mt-0.5 h-6 w-6 flex-shrink-0 text-emerald-500" />}
            <div>
              {result.pwned ? (
                <>
                  <p className="font-heading font-semibold text-red-500">Mot de passe compromis</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Trouvé <span className="font-mono-x font-semibold text-foreground">{formatNumber(result.count)}</span> fois dans des fuites connues. Ne l'utilisez sur aucun compte et changez-le partout où il est employé.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-heading font-semibold text-emerald-500">Aucune fuite détectée</p>
                  <p className="mt-1 text-sm text-muted-foreground">Ce mot de passe n'apparaît dans aucune fuite connue. Utilisez tout de même un mot de passe unique par service.</p>
                </>
              )}
            </div>
          </div>
        )}
        {result?.error && <p className="text-sm text-red-500">Service momentanément indisponible. Réessayez.</p>}
      </DialogContent>
    </Dialog>
  );
};
