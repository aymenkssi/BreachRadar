import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Crown, Check, Loader2, AlertTriangle, BellRing, KeyRound, Mail, CreditCard, Tag, X, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/AuthProvider";
import {
  getBillingConfig, activateSubscription, cancelSubscription, startStripeCheckout, createPaypalSubscription,
  checkPromo, errorMessage,
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
  const inTrial = !cancelled && sub.trial_end && new Date(sub.trial_end) > new Date();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
        <p className="font-heading flex items-center gap-2 font-semibold text-primary">
          <Crown className="h-5 w-5" /> {inTrial ? "Essai gratuit en cours" : "Premium actif"}
        </p>
        {inTrial && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="trial-info">
            Aucun prélèvement avant le <span className="text-foreground">{formatDate(sub.trial_end)}</span> : l'abonnement
            {sub.plan === "yearly" ? " annuel" : " mensuel"} démarre alors automatiquement. Résiliez avant cette date pour ne rien payer.
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {sub.plan && <>Formule {sub.plan === "yearly" ? "annuelle" : "mensuelle"}
            {sub.provider && <> ({sub.provider === "stripe" ? "carte bancaire" : "PayPal"})</>} · </>}
          {!sub.status && "accès offert jusqu'au "}
          {sub.status && (cancelled ? "résiliée, accès jusqu'au " : inTrial ? "premier prélèvement le " : "renouvellement le ")}
          <span className="text-foreground">{formatDate(inTrial ? sub.trial_end : user.premium_until)}</span>
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
              {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {inTrial ? "Résilier l'essai" : "Résilier l'abonnement"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Résilier l'abonnement ?</AlertDialogTitle>
              <AlertDialogDescription>
                {inTrial
                  ? <>Vous ne serez pas prélevé. Vous gardez Premium jusqu'à la fin de l'essai, le {formatDate(sub.trial_end)} ;
                    ensuite la veille et les alertes s'arrêtent.</>
                  : <>Aucun nouveau prélèvement ne sera effectué. Vous gardez Premium jusqu'au {formatDate(user.premium_until)} ;
                    ensuite la veille et les alertes s'arrêtent.</>}
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
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const buttonsRef = useRef(null);

  useEffect(() => {
    getBillingConfig().then(setConfig).catch(() => setConfig({ enabled: false, plans: [] }));
  }, []);

  const promoCode = promo ? promo.code : null;
  const trial = promo?.kind === "free";
  const paypalAllowed = config?.paypal?.enabled && (!promoCode || promo.paypal);

  const applyPromo = async (code = promoInput, forPlan = plan) => {
    if (!code.trim()) return;
    setPromoBusy(true);
    try {
      setPromo(await checkPromo(code.trim(), forPlan));
    } catch (err) {
      setPromo(null);
      toast.error(errorMessage(err, "Code promo invalide."));
    } finally {
      setPromoBusy(false);
    }
  };

  const choosePlan = (key) => {
    setPlan(key);
    if (promo) applyPromo(promo.code, key);  // le prix réduit dépend de la formule
  };

  useEffect(() => {
    if (!paypalAllowed || !consent || user?.premium || !buttonsRef.current) return undefined;
    let buttons;
    let disposed = false;
    loadPaypal(config.paypal.client_id).then((paypal) => {
      if (disposed || !buttonsRef.current) return;
      buttonsRef.current.innerHTML = "";
      buttons = paypal.Buttons({
        style: { layout: "vertical", label: "subscribe", shape: "rect" },
        // Abonnement créé par le serveur : le prix (réduit ou non) ne peut pas être modifié dans le navigateur
        createSubscription: () => createPaypalSubscription(plan, promoCode)
          .then((r) => r.id)
          .catch((err) => { toast.error(errorMessage(err, "Paiement PayPal indisponible.")); throw err; }),
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
  }, [config, plan, promoCode, paypalAllowed, consent, user?.premium, user?.id, setUser]);

  const payByCard = async () => {
    setRedirecting(true);
    try {
      const { url } = await startStripeCheckout(plan, promoCode);
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

  const promoBlock = promo ? (
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm" data-testid="promo-applied">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium"><Tag className="h-4 w-4 text-primary" /> {promo.code}</span>
          <button type="button" onClick={() => { setPromo(null); setPromoInput(""); }} aria-label="Retirer le code"
            className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-muted-foreground">{promo.description}
          {promo.price_after && !trial && <> : <span className="text-foreground">{promo.price_after}</span> au lieu de {promo.price_before}</>}</p>
      {trial && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="trial-terms">
          Votre moyen de paiement est enregistré mais rien n'est prélevé avant le{" "}
          <span className="text-foreground">{formatDate(promo.trial_end)}</span>. Résiliable sans frais pendant l'essai depuis
          « Mon compte » ; sinon l'abonnement démarre automatiquement à cette date.
        </p>
      )}
        {promoCode && config.paypal?.enabled && !promo.paypal && (
          <p className="mt-1 text-xs text-amber-500">Avec PayPal, ce code laisserait un prix inférieur à 0,50 € : il s'applique uniquement au paiement par carte bancaire.</p>
        )}
      </div>
    ) : (
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyPromo(); }}>
        <Input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="Code promo"
          className="font-mono-x uppercase" data-testid="promo-input" />
        <Button type="submit" variant="outline" disabled={promoBusy || !promoInput.trim()} data-testid="promo-apply-btn">
          {promoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Appliquer"}
        </Button>
      </form>
    );

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
        <>
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            L'abonnement Premium sera bientôt disponible.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {config.plans.map((p) => (
              <button key={p.key} type="button" onClick={() => choosePlan(p.key)} data-testid={`plan-${p.key}`}
                className={`rounded-xl border p-4 text-left transition ${plan === p.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
                <p className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">{p.label}</p>
                {promoCode && plan === p.key && trial ? (
                  <p className="mt-1 font-heading text-xl font-bold">
                    0 € <span className="text-sm font-normal text-muted-foreground">pendant {promo.trial_days} j, puis {p.price}</span>
                  </p>
                ) : promoCode && plan === p.key && promo.price_after ? (
                  <p className="mt-1 font-heading text-xl font-bold">
                    {promo.price_after} <span className="text-sm font-normal text-muted-foreground line-through">{p.price}</span>
                  </p>
                ) : <p className="mt-1 font-heading text-xl font-bold">{p.price}</p>}
                <p className="text-xs text-muted-foreground">par {p.period}</p>
              </button>
            ))}
          </div>
          {promoBlock}
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
          {consent && paypalAllowed && (sdkError ? (
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
