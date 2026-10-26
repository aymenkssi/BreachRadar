import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Crown, Check, Loader2, AlertTriangle, BellRing, KeyRound, Mail, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/AuthProvider";
import {
  getBillingConfig, activateSubscription, cancelSubscription, startStripeCheckout, errorMessage,
} from "@/lib/api";

const FEATURES = [
  { icon: BellRing, text: "Veille quotidienne de vos adresses e-mail" },
  { icon: Mail, text: "Alerte par e-mail dès qu'une nouvelle fuite vous concerne" },
  { icon: KeyRound, text: "Rapport détaillé de l'exposition de vos mots de passe" },
];

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

// Le SDK PayPal n'est chargé qu'une fois, à la première ouverture de l'offre.
let paypalSdk = null;
const loadPaypal = (clientId) => {
  if (!paypalSdk) {
    paypalSdk = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=EUR&locale=fr_FR`;
      s.onload = () => resolve(window.paypal);
      s.onerror = () => { paypalSdk = null; reject(new Error("PayPal indisponible")); };
      document.body.appendChild(s);
    });
  }
  return paypalSdk;
};

const SubscriptionStatus = ({ user, onCancel, cancelling }) => {
  const sub = user.subscription || {};
  const cancelled = sub.status === "CANCELLED";
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
        <p className="font-heading flex items-center gap-2 font-semibold text-primary">
          <Crown className="h-5 w-5" /> Premium actif
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {sub.plan && <>Formule {sub.plan === "yearly" ? "annuelle" : "mensuelle"}
            {sub.provider && <> ({sub.provider === "stripe" ? "carte bancaire" : "PayPal"})</>} · </>}
          {!sub.status && "accès offert jusqu'au "}
          {sub.status && (cancelled ? "résiliée, accès jusqu'au " : "renouvellement le ")}
          <span className="text-foreground">{formatDate(user.premium_until)}</span>
        </p>
      </div>
      <ul className="space-y-2">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-primary" /> {text}</li>
        ))}
      </ul>
      {!cancelled && sub.status && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={cancelling} data-testid="cancel-subscription-btn">
              {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Résilier l'abonnement
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Résilier l'abonnement ?</AlertDialogTitle>
              <AlertDialogDescription>
                Aucun nouveau prélèvement ne sera effectué. Vous gardez Premium jusqu'au {formatDate(user.premium_until)} ;
                ensuite la veille et les alertes s'arrêtent.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Garder Premium</AlertDialogCancel>
              <AlertDialogAction onClick={onCancel}>Résilier</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

export const PremiumPanel = () => {
  const { user, setUser } = useAuth();
  const [config, setConfig] = useState(null);
  const [plan, setPlan] = useState("yearly");
  const [cancelling, setCancelling] = useState(false);
  const [activating, setActivating] = useState(false);
  const [sdkError, setSdkError] = useState(false);
  const [consent, setConsent] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const buttonsRef = useRef(null);

  useEffect(() => {
    getBillingConfig().then(setConfig).catch(() => setConfig({ enabled: false, plans: [] }));
  }, []);

  const paypalPlanId = config?.paypal?.plans?.[plan];

  useEffect(() => {
    if (!config?.paypal?.enabled || !paypalPlanId || !consent || user?.premium || !buttonsRef.current) return undefined;
    let buttons;
    let disposed = false;
    loadPaypal(config.paypal.client_id).then((paypal) => {
      if (disposed || !buttonsRef.current) return;
      buttonsRef.current.innerHTML = "";
      buttons = paypal.Buttons({
        style: { layout: "vertical", label: "subscribe", shape: "rect" },
        createSubscription: (data, actions) =>
          actions.subscription.create({ plan_id: paypalPlanId, custom_id: user.id }),
        onApprove: async (data) => {
          setActivating(true);
          try {
            setUser(await activateSubscription(data.subscriptionID));
            toast.success("Bienvenue dans Premium !");
          } catch (err) {
            toast.error(errorMessage(err, "Paiement reçu mais activation impossible : contactez-nous."));
          } finally {
            setActivating(false);
          }
        },
        onError: () => toast.error("Le paiement PayPal a échoué."),
      });
      buttons.render(buttonsRef.current);
    }).catch(() => setSdkError(true));
    return () => { disposed = true; buttons?.close?.(); };
  }, [config, paypalPlanId, consent, user?.premium, user?.id, setUser]);

  const payByCard = async () => {
    setRedirecting(true);
    try {
      const { url } = await startStripeCheckout(plan);
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err, "Paiement par carte indisponible."));
      setRedirecting(false);
    }
  };

  const onCancel = async () => {
    setCancelling(true);
    try {
      setUser(await cancelSubscription());
      toast.success("Abonnement résilié.");
    } catch (err) {
      toast.error(errorMessage(err, "Résiliation impossible."));
    } finally {
      setCancelling(false);
    }
  };

  if (user.premium) return <SubscriptionStatus user={user} onCancel={onCancel} cancelling={cancelling} />;

  return (
    <div className="space-y-5">
      {user.subscription?.status === "SUSPENDED" && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          Le dernier paiement a échoué : mettez à jour votre moyen de paiement dans PayPal pour réactiver Premium.
        </p>
      )}
      <ul className="space-y-2">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-primary" /> {text}</li>
        ))}
      </ul>

      {!config ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !config.enabled ? (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          L'abonnement Premium sera bientôt disponible.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {config.plans.map((p) => (
              <button key={p.key} type="button" onClick={() => setPlan(p.key)} data-testid={`plan-${p.key}`}
                className={`rounded-xl border p-4 text-left transition ${plan === p.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                <p className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">{p.label}</p>
                <p className="mt-1 font-heading text-xl font-bold">{p.price}</p>
                <p className="text-xs text-muted-foreground">par {p.period}</p>
              </button>
            ))}
          </div>
          <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5"
              data-testid="withdrawal-consent" />
            <span>
              J'accepte les <Link to="/cgv" target="_blank" className="text-primary hover:underline">CGV</Link> et je
              demande à bénéficier de Premium immédiatement. Si j'exerce mon droit de rétractation dans les 14 jours, le
              montant correspondant au service déjà fourni restera dû.
            </span>
          </label>
          {activating && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Activation…</p>
          )}
          {consent && config.stripe?.enabled && (
            <Button className="w-full gap-2" onClick={payByCard} disabled={redirecting} data-testid="stripe-pay-btn">
              {redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Payer par carte bancaire
            </Button>
          )}
          {consent && config.paypal?.enabled && (sdkError ? (
            <p className="text-sm text-red-500">Impossible de charger PayPal. Désactivez un éventuel bloqueur de publicités et réessayez.</p>
          ) : (
            <div ref={buttonsRef} data-testid="paypal-buttons" />
          ))}
          <p className="text-xs text-muted-foreground">
            Paiement sécurisé par {[config.stripe?.enabled && "Stripe", config.paypal?.enabled && "PayPal"].filter(Boolean).join(" ou ")},
            renouvelé automatiquement, résiliable à tout moment depuis cet écran (effet à la fin de la période payée).
          </p>
        </>
      )}
    </div>
  );
};
