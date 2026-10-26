import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus, MailCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/AuthProvider";
import {
  login, register, verifyAccount, resendAccountCode, forgotPassword, resetPassword, errorMessage,
} from "@/lib/api";

const TITLES = {
  login: { icon: LogIn, title: "Connexion", text: "Accédez à vos alertes et à votre abonnement Premium." },
  register: { icon: UserPlus, title: "Créer un compte", text: "Un code de confirmation sera envoyé à votre adresse." },
  verify: { icon: MailCheck, title: "Confirmez votre adresse", text: "Saisissez le code à 6 chiffres reçu par e-mail." },
  forgot: { icon: KeyRound, title: "Mot de passe oublié", text: "Recevez un code pour choisir un nouveau mot de passe." },
  reset: { icon: KeyRound, title: "Nouveau mot de passe", text: "Saisissez le code reçu et votre nouveau mot de passe." },
};

export const AuthPanel = () => {
  const { signIn } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const go = (m) => { setMode(m); setCode(""); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        try {
          signIn(await login(email, password));
          toast.success("Connecté.");
        } catch (err) {
          if (err?.response?.data?.detail === "email_not_verified") {
            toast.info("Adresse non confirmée : un code vous a été envoyé.");
            go("verify");
          } else throw err;
        }
      } else if (mode === "register") {
        await register(email, password, acceptTerms);
        toast.success("Code envoyé par e-mail.");
        go("verify");
      } else if (mode === "verify") {
        signIn(await verifyAccount(email, code));
        toast.success("Compte confirmé, bienvenue !");
      } else if (mode === "forgot") {
        await forgotPassword(email);
        toast.success("Si un compte existe pour cette adresse, un code vient d'être envoyé.");
        go("reset");
      } else if (mode === "reset") {
        signIn(await resetPassword(email, code, password));
        toast.success("Mot de passe modifié.");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Opération impossible. Vérifiez les informations saisies."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await (mode === "verify" ? resendAccountCode(email) : forgotPassword(email));
      toast.success("Nouveau code envoyé.");
    } catch (err) {
      toast.error(errorMessage(err, "Envoi impossible."));
    }
  };

  const { icon: Icon, title, text } = TITLES[mode];
  const needsPassword = ["login", "register", "reset"].includes(mode);
  const needsCode = ["verify", "reset"].includes(mode);

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="auth-form">
      <div>
        <h3 className="font-heading flex items-center gap-2 text-lg font-semibold">
          <Icon className="h-5 w-5 text-primary" /> {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auth-email">Adresse e-mail</Label>
        <Input id="auth-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} disabled={needsCode} data-testid="auth-email" />
      </div>

      {needsCode && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-code">Code reçu par e-mail</Label>
          <Input id="auth-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="font-mono-x tracking-[0.4em]" data-testid="auth-code" />
        </div>
      )}

      {needsPassword && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-password">{mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"}</Label>
          <Input id="auth-password" type="password" required minLength={8} maxLength={128}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} data-testid="auth-password" />
          {mode !== "login" && <p className="text-xs text-muted-foreground">8 caractères minimum.</p>}
        </div>
      )}

      {mode === "register" && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" required checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5" data-testid="auth-terms" />
          <span>
            J'accepte les <Link to="/cgv" target="_blank" className="text-primary hover:underline">conditions générales</Link> et
            la <Link to="/confidentialite" target="_blank" className="text-primary hover:underline">politique de confidentialité</Link>.
          </span>
        </label>
      )}

      <Button type="submit" className="w-full gap-2" disabled={busy} data-testid="auth-submit">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {{ login: "Se connecter", register: "Créer mon compte", verify: "Confirmer", forgot: "Envoyer le code", reset: "Changer le mot de passe" }[mode]}
      </Button>

      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {mode === "login" && (
          <>
            <button type="button" className="text-primary hover:underline" onClick={() => go("register")}>Créer un compte</button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go("forgot")}>Mot de passe oublié ?</button>
          </>
        )}
        {needsCode && (
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={resend}>Renvoyer le code</button>
        )}
        {mode !== "login" && (
          <button type="button" className="text-primary hover:underline" onClick={() => go("login")}>J'ai déjà un compte</button>
        )}
      </div>
    </form>
  );
};
