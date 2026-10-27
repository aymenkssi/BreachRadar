import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Radar, ShieldAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/AuthProvider";
import { usePageMeta } from "@/lib/usePageMeta";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminPayments } from "@/components/admin/AdminPayments";
import { AdminSmtp } from "@/components/admin/AdminSmtp";
import { AdminLegal, AdminAudit } from "@/components/admin/AdminLegal";
import { AdminPromos } from "@/components/admin/AdminPromos";
import { ThemeToggle } from "@/components/investigation/ThemeToggle";

const TABS = [
  ["overview", "Vue d'ensemble", AdminOverview],
  ["users", "Abonnés", AdminUsers],
  ["payments", "Paiement", AdminPayments],
  ["promos", "Codes promo", AdminPromos],
  ["emails", "E-mails", AdminSmtp],
  ["legal", "Infos légales", AdminLegal],
  ["audit", "Journal", AdminAudit],
];

export default function AdminPage() {
  const { user, ready } = useAuth();
  usePageMeta({ title: "Administration · BreachRadar", path: "/admin", noindex: true });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <Link to="/" className="flex items-center gap-2 font-heading font-bold">
            <Radar className="h-5 w-5 text-primary" /> BreachRadar<span className="text-primary">AI</span>
            <span className="ml-2 hidden rounded-md bg-primary/15 px-2 py-0.5 text-xs text-primary min-[420px]:inline">Administration</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Site
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {!ready ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : !user?.is_admin ? (
          <div className="flex flex-col items-center py-24 text-center">
            <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {user ? "Votre compte n'a pas accès à l'administration." : "Connectez-vous avec un compte administrateur depuis le site."}
            </p>
            <Link to="/" className="mt-4 text-sm text-primary hover:underline">Retour au site</Link>
          </div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
              {TABS.map(([k, label]) => <TabsTrigger key={k} value={k} data-testid={`admin-tab-${k}`}>{label}</TabsTrigger>)}
            </TabsList>
            {TABS.map(([k, , Component]) => <TabsContent key={k} value={k}><Component /></TabsContent>)}
          </Tabs>
        )}
      </main>
    </div>
  );
}
