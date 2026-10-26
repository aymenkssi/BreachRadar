import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/AuthProvider";
import { exportMyData, deleteMyAccount, errorMessage } from "@/lib/api";

// Droits RGPD : portabilité (export JSON) et effacement (suppression du compte)
export const MyDataSection = () => {
  const { signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      const data = await exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "breachradar-mes-donnees.json" });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err, "Export impossible."));
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await deleteMyAccount(password);
      signOut();
      toast.success("Votre compte et vos données ont été supprimés.");
    } catch (err) {
      toast.error(errorMessage(err, "Suppression impossible."));
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 space-y-2 border-t border-border pt-4">
      <p className="flex items-center gap-1.5 text-xs font-mono-x uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-4 w-4" /> Mes données
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={download} data-testid="export-data-btn">
          <Download className="h-4 w-4" /> Exporter mes données
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 text-red-500" data-testid="delete-account-btn">
              <Trash2 className="h-4 w-4" /> Supprimer mon compte
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form onSubmit={remove}>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer définitivement le compte ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Votre compte, vos adresses surveillées et votre historique seront effacés. Un abonnement en cours est
                  résilié (aucun nouveau prélèvement). Saisissez votre mot de passe pour confirmer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input type="password" required className="my-4" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" data-testid="delete-password" />
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Annuler</AlertDialogCancel>
                <Button type="submit" variant="destructive" disabled={busy || !password}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Supprimer
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p className="text-xs text-muted-foreground">
        Voir la <Link to="/confidentialite" className="text-primary hover:underline">politique de confidentialité</Link>.
      </p>
    </div>
  );
};
