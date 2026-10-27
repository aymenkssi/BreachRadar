import { useState } from "react";
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, ShieldAlert, Search, Crown, ListFilter } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";

// k-anonymat : le navigateur calcule l'empreinte SHA-1 et n'envoie à Pwned Passwords que ses 5 premiers
// caractères ; la comparaison se fait ici. Le mot de passe ne quitte jamais l'appareil.
const checkPassword = async (password) => {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
  if (!res.ok) throw new Error("Pwned Passwords indisponible");
  const line = (await res.text()).split("\n").find((l) => l.startsWith(hash.slice(5)));
  const count = line ? parseInt(line.split(":")[1], 10) || 0 : 0;
  return { pwned: count > 0, count };
};
import { formatNumber } from "@/lib/format";

// Pwned Passwords ne dit pas de quelle fuite vient un mot de passe (k-anonymat, volontairement).
// Si le mot de passe est compromis, on oriente vers ce qui donne l'origine : les fuites de l'adresse
// e-mail du client (onSearchEmail) et, pour les abonnés, le rapport des mots de passe (onOpenReport).
export const PasswordCheckDialog = ({ onSearchEmail, onOpenReport }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
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
    if (o) setEmail(user?.email || "");
    if (!o) { setValue(""); setResult(null); setShow(false); }
  };

  const searchEmail = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    reset(false);
    onSearchEmail?.(email.trim());
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
            Vérifiez si un mot de passe figure dans des fuites connues. Confidentiel : votre navigateur calcule l'empreinte SHA-1 du mot de passe et n'envoie que ses 5 premiers caractères (k-anonymat) — le mot de passe ne quitte jamais votre appareil.
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
        {result?.pwned && onSearchEmail && (
          <div className="space-y-2 rounded-xl border border-border p-4" data-testid="password-origin">
            <p className="text-sm font-medium">D'où vient cette fuite ?</p>
            <p className="text-xs text-muted-foreground">
              Les bases de mots de passe divulgués n'indiquent jamais leur origine. Cherchez plutôt les fuites qui
              concernent votre adresse e-mail : celles qui contenaient des mots de passe vous diront sur quel service
              ce mot de passe a probablement été volé.
            </p>
            <form onSubmit={searchEmail} className="flex gap-2">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@adresse.fr"
                data-testid="password-origin-email"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 font-mono-x text-sm outline-none focus:border-primary/50" />
              <Button type="submit" size="sm" className="gap-1.5" data-testid="password-origin-search">
                <ListFilter className="h-4 w-4" /> Voir les fuites
              </Button>
            </form>
            {onOpenReport && (
              <button type="button" onClick={() => { reset(false); onOpenReport(); }} data-testid="password-origin-report"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Crown className="h-3.5 w-3.5" />
                {user?.premium ? "Ouvrir mon rapport des mots de passe (fuite par fuite)"
                  : "Premium : rapport des mots de passe, fuite par fuite"}
              </button>
            )}
          </div>
        )}
        {result?.error && <p className="text-sm text-red-500">Service momentanément indisponible. Réessayez.</p>}
      </DialogContent>
    </Dialog>
  );
};
