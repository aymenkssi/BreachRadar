import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, Radar, AlertTriangle, ShieldOff, Bell, Loader2, Crown } from "lucide-react";
import { SearchBar } from "@/components/investigation/SearchBar";
import { ScoreGauge } from "@/components/investigation/ScoreGauge";
import { StatsGrid } from "@/components/investigation/StatsGrid";
import { AiReportPanel } from "@/components/investigation/AiReportPanel";
import { BreachTable } from "@/components/investigation/BreachTable";
import { HistorySidebar } from "@/components/investigation/HistorySidebar";
import { ScanningState } from "@/components/investigation/ScanningState";
import { BreachTimeline } from "@/components/investigation/BreachTimeline";
import { DataCategoryMap } from "@/components/investigation/DataCategoryMap";
import { BatchDialog } from "@/components/investigation/BatchDialog";
import { PasswordCheckDialog } from "@/components/investigation/PasswordCheckDialog";
import { WatchlistSheet } from "@/components/investigation/WatchlistSheet";
import { CompareDialog } from "@/components/investigation/CompareDialog";
import { ThemeToggle } from "@/components/investigation/ThemeToggle";
import { AccountSheet } from "@/components/account/AccountSheet";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { investigate, getHistory, deleteInvestigation, clearHistory, generateReport, getWatchlist, addWatch, confirmStripeCheckout, errorMessage } from "@/lib/api";

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 py-24 text-center">
    <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
      <Radar className="h-9 w-9 text-primary" />
      <span className="pulse-ring absolute inset-0 rounded-2xl bg-primary/20" />
    </div>
    <h3 className="font-heading text-xl font-bold">Lancez votre première investigation</h3>
    <p className="mt-2 max-w-md text-sm text-muted-foreground">
      Saisissez une adresse email, un domaine ou un nom d'utilisateur. BreachRadar interroge des bases
      de fuites réelles et génère un rapport de renseignement propulsé par l'IA.
    </p>
    <div className="mt-6 flex flex-wrap justify-center gap-6 text-xs font-mono-x text-muted-foreground">
      <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Données réelles</span>
      <span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" /> Score de compromission</span>
      <span className="flex items-center gap-1.5"><ShieldOff className="h-4 w-4 text-red-500" /> Analyse des menaces</span>
    </div>
  </div>
);

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [target, setTarget] = useState("");
  const [history, setHistory] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [watching, setWatching] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState("premium");
  const { user, ready, setUser } = useAuth();

  const openAccount = (tab) => { setAccountTab(tab); setAccountOpen(true); };

  const loadHistory = async () => {
    try { setHistory(await getHistory()); } catch { /* noop */ }
  };
  const loadWatchlist = async () => {
    try { setWatchlist(await getWatchlist()); } catch { /* noop */ }
  };
  // Historique et surveillance sont propres au compte connecté (ou à ce navigateur)
  useEffect(() => {
    if (!ready) return;
    loadHistory();
    loadWatchlist();
  }, [ready, user?.id]);

  // Retour de la page de paiement Stripe : ?premium=stripe&session_id=… ou ?premium=cancel
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("premium");
    if (!status) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (status === "cancel") {
      toast.info("Paiement annulé.");
      return;
    }
    const sessionId = params.get("session_id");
    if (status === "stripe" && sessionId && user) {
      confirmStripeCheckout(sessionId)
        .then((me) => { setUser(me); toast.success("Bienvenue dans Premium !"); openAccount("monitors"); })
        .catch((err) => toast.error(errorMessage(err, "Paiement reçu mais activation impossible : contactez-nous.")));
    }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const isWatched = result && watchlist.some((w) => w.target.toLowerCase() === result.target.toLowerCase());

  const handleWatch = async () => {
    if (!result) return;
    setWatching(true);
    try {
      await addWatch(result.target);
      await loadWatchlist();
      toast.success(`${result.target} ajouté à la surveillance.`);
    } catch {
      toast.error("Impossible d'ajouter à la surveillance.");
    } finally {
      setWatching(false);
    }
  };

  const runInvestigation = async (t) => {
    setTarget(t);
    setLoading(true);
    setResult(null);
    setCategoryFilter(null);
    try {
      const data = await investigate(t);
      setResult(data);
      if (data.total_breaches === 0) {
        toast.success("Aucune fuite trouvée pour cette cible.");
      } else {
        toast.warning(`${data.total_breaches} fuite(s) détectée(s) — risque ${data.risk_label}.`);
      }
      loadHistory();
    } catch (e) {
      toast.error("Échec de l'investigation. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    await deleteInvestigation(id);
    loadHistory();
  };
  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
    toast.success("Historique effacé.");
  };
  const handleSelect = (h) => { setResult(h); setTarget(h.target); setCategoryFilter(null); };

  const handleGenerateReport = async () => {
    if (!result) return;
    setGenerating(true);
    try {
      const updated = await generateReport(result.id);
      setResult(updated);
      loadHistory();
      toast.success("Rapport IA généré.");
    } catch {
      toast.error("Échec de la génération du rapport.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-96" />

      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
              <Radar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold leading-none tracking-tight">BreachRadar<span className="text-primary"> AI</span></h1>
              <p className="text-[11px] font-mono-x uppercase tracking-widest text-muted-foreground">Threat Intelligence · Investigation de fuites</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <PasswordCheckDialog />
              <BatchDialog onSelect={handleSelect} onDone={loadHistory} />
              <CompareDialog history={history} />
            </div>
            <WatchlistSheet watchlist={watchlist} onChange={loadWatchlist} />
            <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} tab={accountTab} onTabChange={setAccountTab} />
            <HistorySidebar history={history} onSelect={handleSelect} onDelete={handleDelete} onClear={handleClear} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Investiguez toute <span className="text-primary">fuite de données</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Détectez les comptes compromis et évaluez le risque à partir d'un simple mot-clé, avec l'aide d'une IA de cyber-renseignement.
          </p>
        </div>

        <div className="mx-auto mb-4 max-w-3xl">
          <SearchBar onSearch={runInvestigation} loading={loading} />
        </div>
        <div className="mx-auto mb-10 flex max-w-3xl flex-wrap justify-center gap-2 sm:hidden">
          <PasswordCheckDialog />
          <BatchDialog onSelect={handleSelect} onDone={loadHistory} />
          <CompareDialog history={history} />
        </div>

        {loading && <ScanningState target={target} />}

        {!loading && !result && <EmptyState />}

        {!loading && result && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md lg:col-span-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">Score de compromission</span>
                </div>
                <ScoreGauge score={result.score} riskLabel={result.risk_label} />
                <p className="mt-4 break-all text-center font-mono-x text-sm text-foreground">{result.target}</p>
                <Button
                  data-testid="watch-target-btn"
                  onClick={handleWatch}
                  disabled={watching || isWatched}
                  variant={isWatched ? "secondary" : "outline"}
                  className="mt-4 w-full gap-2"
                >
                  {watching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                  {isWatched ? "Sous surveillance" : "Surveiller cette cible"}
                </Button>
                {result.target_type === "email" && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <Button variant="ghost" size="sm" className="gap-2 text-primary" onClick={() => openAccount("monitors")}
                      data-testid="premium-alerts-btn">
                      <Crown className="h-4 w-4" /> Alerte e-mail à chaque nouvelle fuite
                    </Button>
                    {result.exposed_passwords && (
                      <Button variant="ghost" size="sm" className="gap-2 text-primary" onClick={() => openAccount("passwords")}
                        data-testid="premium-passwords-btn">
                        <Crown className="h-4 w-4" /> Rapport détaillé des mots de passe
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-center gap-4 rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md lg:col-span-8">
                <StatsGrid data={result} />
                {result.exposed_data_classes?.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-mono-x uppercase tracking-wider text-muted-foreground">Catégories de données exposées</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.exposed_data_classes.slice(0, 16).map((c) => (
                        <span key={c} className="rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(result.yearwise?.length > 0 || result.data_categories?.length > 0) && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {result.yearwise?.length > 0 && <BreachTimeline data={result.yearwise} />}
                {result.data_categories?.length > 0 && (
                  <DataCategoryMap
                    categories={result.data_categories}
                    totalBreaches={result.total_breaches}
                    activeCategory={categoryFilter}
                    onSelect={setCategoryFilter}
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <AiReportPanel investigation={result} onGenerate={handleGenerateReport} generating={generating} />
              </div>
              <div className="lg:col-span-7">
                {result.breaches?.length > 0 ? (
                  <BreachTable breaches={result.breaches} categoryFilter={categoryFilter} onClearCategory={() => setCategoryFilter(null)} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/5 py-20 text-center">
                    <ShieldCheck className="mb-3 h-12 w-12 text-emerald-500" />
                    <h3 className="font-heading text-lg font-semibold">Aucune fuite détectée</h3>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">Cette cible n'apparaît dans aucune fuite connue. Restez vigilant et maintenez de bonnes pratiques de sécurité.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-border py-6 text-center text-xs font-mono-x text-muted-foreground">
        <p>BreachRadar AI · Données de fuites fournies par XposedOrNot · À usage éducatif et de sensibilisation</p>
        <nav className="mt-2 flex flex-wrap justify-center gap-4">
          <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
          <Link to="/cgv" className="hover:text-foreground">CGV</Link>
          <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link>
        </nav>
      </footer>
    </div>
  );
}
