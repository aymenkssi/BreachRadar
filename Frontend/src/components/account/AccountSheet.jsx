import { Crown, LogIn, LogOut, UserRound, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { AuthPanel } from "@/components/account/AuthPanel";
import { PremiumPanel } from "@/components/account/PremiumPanel";
import { MonitorsPanel } from "@/components/account/MonitorsPanel";
import { PasswordReportPanel } from "@/components/account/PasswordReportPanel";

// Ouvert depuis l'en-tête, ou par le tableau de bord sur un onglet précis (tab / onTabChange).
export const AccountSheet = ({ open, onOpenChange, tab, onTabChange }) => {
  const { user, ready, signOut } = useAuth();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant={user?.premium ? "default" : "outline"} size="sm" className="gap-2" data-testid="account-open-btn">
          {!ready ? <Loader2 className="h-4 w-4 animate-spin" />
            : user ? (user.premium ? <Crown className="h-4 w-4" /> : <UserRound className="h-4 w-4" />)
              : <LogIn className="h-4 w-4" />}
          <span className="hidden sm:inline">{user ? (user.premium ? "Premium" : "Mon compte") : "Connexion"}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto border-border bg-card sm:max-w-lg">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-heading flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" /> BreachRadar Premium
          </SheetTitle>
          <SheetDescription>
            {user ? <>Connecté en tant que <span className="text-foreground">{user.email}</span></>
              : "Veille de vos adresses, alertes e-mail et rapport des mots de passe."}
          </SheetDescription>
        </SheetHeader>

        {!user ? <AuthPanel /> : (
          <>
            <Tabs value={tab} onValueChange={onTabChange}>
              <TabsList className="mb-4 grid w-full grid-cols-3">
                <TabsTrigger value="premium" data-testid="tab-premium">Abonnement</TabsTrigger>
                <TabsTrigger value="monitors" data-testid="tab-monitors">Veille e-mail</TabsTrigger>
                <TabsTrigger value="passwords" data-testid="tab-passwords">Mots de passe</TabsTrigger>
              </TabsList>
              <TabsContent value="premium"><PremiumPanel /></TabsContent>
              <TabsContent value="monitors"><MonitorsPanel onUpgrade={() => onTabChange("premium")} /></TabsContent>
              <TabsContent value="passwords"><PasswordReportPanel onUpgrade={() => onTabChange("premium")} /></TabsContent>
            </Tabs>
            <Button variant="ghost" size="sm" className="mt-6 gap-2 text-muted-foreground" onClick={signOut} data-testid="logout-btn">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
