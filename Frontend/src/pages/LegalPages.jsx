import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Radar } from "lucide-react";
import { getLegal } from "@/lib/api";

// Pages Mentions légales, CGV et Politique de confidentialité. Les informations sur l'éditeur
// (raison sociale, SIRET, hébergeur, médiateur…) se saisissent dans l'administration ; tant
// qu'elles manquent, un repère « à compléter » s'affiche à leur place.
const UPDATED = "26 octobre 2026";

const useLegal = () => {
  const [legal, setLegal] = useState(null);
  useEffect(() => { getLegal().then(setLegal).catch(() => setLegal({ processors: {}, prices: {} })); }, []);
  return legal;
};

const V = ({ value, label }) =>
  value ? <>{value}</> : <span className="rounded bg-amber-500/15 px-1 text-amber-500">[à compléter : {label}]</span>;

const Layout = ({ title, children }) => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-heading font-bold">
          <Radar className="h-5 w-5 text-primary" /> BreachRadar<span className="text-primary">AI</span>
        </Link>
        <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Retour au site
        </Link>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-heading text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Dernière mise à jour : {UPDATED}</p>
      <div className="legal mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-3 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2 [&_strong]:text-foreground [&_a]:text-primary">
        {children}
      </div>
    </main>
    <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
      <nav className="flex justify-center gap-4">
        <Link to="/mentions-legales">Mentions légales</Link>
        <Link to="/cgv">CGV</Link>
        <Link to="/confidentialite">Confidentialité</Link>
      </nav>
    </footer>
  </div>
);

const Editor = ({ l }) => (
  <>
    <p><strong><V value={l.company_name} label="nom ou raison sociale" /></strong>
      {l.legal_form && <>, {l.legal_form}</>}{l.capital && <> au capital de {l.capital}</>}</p>
    <p>Adresse : <V value={l.address} label="adresse du siège" /></p>
    <p>SIRET : <V value={l.siret} label="numéro SIRET" />{l.rcs && <> · RCS {l.rcs}</>}
      {l.vat_number && <> · TVA intracommunautaire : {l.vat_number}</>}</p>
    <p>Contact : <V value={l.contact_email} label="adresse e-mail de contact" />{l.phone && <> · {l.phone}</>}</p>
  </>
);

const Loading = ({ title }) => <Layout title={title}><p>Chargement…</p></Layout>;

export const LegalNotice = () => {
  const l = useLegal();
  if (!l) return <Loading title="Mentions légales" />;
  return (
    <Layout title="Mentions légales">
      <section>
        <h2>Éditeur du site</h2>
        <p>Le site {l.site_url} (« BreachRadar ») est édité par :</p>
        <Editor l={l} />
        <p>Directeur de la publication : <V value={l.publication_director} label="directeur de la publication" /></p>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p><V value={l.host_name} label="nom de l'hébergeur" /> — <V value={l.host_address} label="adresse de l'hébergeur" />
          {l.host_phone && <> — {l.host_phone}</>}</p>
      </section>
      <section>
        <h2>Sources des données</h2>
        <p>Les informations sur les fuites de données proviennent du service public <strong>XposedOrNot</strong>, qui
          recense des fuites rendues publiques. La vérification d'un mot de passe utilise le service
          <strong> Pwned Passwords</strong> (Have I Been Pwned) selon le principe du k-anonymat : votre navigateur
          n'envoie que les cinq premiers caractères de l'empreinte SHA-1 du mot de passe, jamais le mot de passe.</p>
        <p>BreachRadar n'héberge aucune base de données issue de fuites et n'affiche ni ne conserve aucun mot de passe.</p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>Les textes, éléments graphiques, logiciels et marques du site sont protégés par le droit de la propriété
          intellectuelle. Toute reproduction ou réutilisation sans autorisation préalable de l'éditeur est interdite.</p>
      </section>
      <section>
        <h2>Responsabilité</h2>
        <p>Les résultats sont fournis à titre informatif, à partir de sources tierces : ils peuvent être incomplets et ne
          constituent pas un audit de sécurité. L'éditeur s'efforce d'assurer l'exactitude et la disponibilité du site
          sans pouvoir les garantir.</p>
      </section>
      <section>
        <h2>Données personnelles</h2>
        <p>Voir la <Link to="/confidentialite">politique de confidentialité</Link>. Pour toute question ou
          signalement : <V value={l.contact_email} label="adresse e-mail de contact" />.</p>
      </section>
    </Layout>
  );
};

export const Terms = () => {
  const l = useLegal();
  if (!l) return <Loading title="Conditions générales de vente et d'utilisation" />;
  const payment = [l.processors?.stripe && "carte bancaire via Stripe", l.processors?.paypal && "PayPal"].filter(Boolean);
  return (
    <Layout title="Conditions générales de vente et d'utilisation">
      <section>
        <h2>1. Objet</h2>
        <p>Les présentes conditions régissent l'utilisation du site {l.site_url} et la souscription à l'abonnement
          BreachRadar Premium, proposés par l'éditeur désigné ci-dessous. Elles s'appliquent à tout utilisateur et sont
          acceptées lors de la création d'un compte et de chaque souscription.</p>
        <Editor l={l} />
      </section>
      <section>
        <h2>2. Services</h2>
        <p><strong>Services gratuits</strong>, sans compte : recherche d'une adresse e-mail, d'un domaine ou d'un nom
          d'utilisateur dans les fuites publiques connues, score de compromission, rapport d'analyse par intelligence
          artificielle, vérification anonyme d'un mot de passe, historique et liste de surveillance consultables depuis
          le navigateur utilisé.</p>
        <p><strong>BreachRadar Premium</strong>, avec un compte :</p>
        <ul>
          <li>veille quotidienne d'adresses e-mail et alerte par e-mail lorsqu'une nouvelle fuite les concerne ;</li>
          <li>rapport détaillé indiquant, fuite par fuite, comment les mots de passe étaient protégés et les mesures à
            prendre. Les mots de passe eux-mêmes ne sont jamais communiqués.</li>
        </ul>
        <p>Une adresse ne peut être surveillée ou analysée qu'après preuve que l'utilisateur la contrôle (adresse du
          compte ou code de confirmation reçu sur l'adresse). Le nombre d'adresses surveillées est limité.</p>
        <p>Les informations proviennent de sources tierces (voir les <Link to="/mentions-legales">mentions
          légales</Link>) : elles ne sont pas exhaustives et une fuite non encore publiée ne peut pas être détectée.
          L'éditeur est tenu à une obligation de moyens.</p>
      </section>
      <section>
        <h2>3. Compte</h2>
        <p>L'utilisateur fournit une adresse e-mail valide qu'il confirme par un code, et garde son mot de passe
          confidentiel. Il peut exporter ses données ou supprimer son compte à tout moment depuis « Mon compte ».</p>
      </section>
      <section>
        <h2>4. Prix</h2>
        <p>Formule mensuelle : <strong>{l.prices?.monthly}</strong> par mois. Formule annuelle :
          <strong> {l.prices?.yearly}</strong> par an. Les prix sont indiqués en euros, toutes taxes comprises. Le prix
          applicable est celui affiché au moment de la souscription ; une modification de prix n'est appliquée à un
          abonnement en cours qu'à son renouvellement, après information préalable de l'abonné qui peut alors résilier.</p>
      </section>
      <section>
        <h2>5. Souscription et paiement</h2>
        <p>La souscription s'effectue depuis « Mon compte », en choisissant une formule puis en payant
          {payment.length ? <> par {payment.join(" ou ")}</> : " par l'un des moyens proposés"}. Le paiement est traité
          par ce prestataire : l'éditeur n'a jamais accès aux données bancaires. L'abonnement est activé dès la
          confirmation du paiement ; un récapitulatif est adressé par le prestataire de paiement.</p>
      </section>
      <section>
        <h2>6. Durée, renouvellement et résiliation</h2>
        <p>L'abonnement est conclu pour un mois ou un an selon la formule et se renouvelle automatiquement pour la même
          durée, le paiement étant prélevé à chaque échéance. Pour la formule annuelle, l'abonné est informé par
          e-mail, au plus tôt trois mois et au plus tard un mois avant l'échéance, de la possibilité de ne pas
          reconduire le contrat (article L215-1 du Code de la consommation).</p>
        <p>L'abonné peut résilier à tout moment, sans frais, en quelques clics depuis « Mon compte » → « Abonnement » →
          « Résilier ». La résiliation prend effet à la fin de la période en cours, déjà payée, sans remboursement au
          prorata (hors exercice du droit de rétractation). En cas d'échec de paiement, l'accès Premium est suspendu
          jusqu'à régularisation.</p>
        <p>L'éditeur peut suspendre ou résilier un compte en cas de manquement grave aux présentes conditions, notamment
          la surveillance d'adresses appartenant à des tiers sans leur accord.</p>
      </section>
      <section>
        <h2>7. Droit de rétractation</h2>
        <p>Le consommateur dispose d'un délai de <strong>14 jours</strong> à compter de la souscription pour se
          rétracter, sans avoir à motiver sa décision (articles L221-18 et suivants du Code de la consommation). Lors de
          la souscription, il demande expressément que le service commence immédiatement : s'il se rétracte ensuite, il
          reste redevable d'un montant proportionnel au service fourni jusqu'à la communication de sa décision
          (article L221-25).</p>
        <p>Pour exercer ce droit, il adresse une déclaration dénuée d'ambiguïté (par exemple le formulaire ci-dessous) à
          <V value={l.contact_email} label="adresse e-mail de contact" />. Le remboursement intervient au plus tard
          14 jours après réception de la demande, par le même moyen de paiement.</p>
      </section>
      <section>
        <h2>8. Obligations de l'utilisateur</h2>
        <p>L'utilisateur s'engage à utiliser le service pour protéger ses propres comptes ou ceux dont il a la
          responsabilité, dans le respect de la loi, et à ne pas tenter de contourner les mesures de vérification, de
          perturber le service ou d'en extraire massivement les données.</p>
      </section>
      <section>
        <h2>9. Garanties et responsabilité</h2>
        <p>Le consommateur bénéficie de la garantie légale de conformité des services numériques (articles L224-25-12 et
          suivants du Code de la consommation). L'éditeur n'est pas responsable des dommages résultant d'une fuite de
          données elle-même, d'une indisponibilité des sources tierces ou d'un usage du service non conforme aux présentes.</p>
      </section>
      <section>
        <h2>10. Données personnelles</h2>
        <p>Le traitement des données est décrit dans la <Link to="/confidentialite">politique de confidentialité</Link>.</p>
      </section>
      <section>
        <h2>11. Réclamations et médiation</h2>
        <p>Toute réclamation peut être adressée à <V value={l.contact_email} label="adresse e-mail de contact" />. À
          défaut de solution, le consommateur peut recourir gratuitement au médiateur de la consommation :
          {" "}<V value={l.mediator_name} label="médiateur de la consommation" />
          {l.mediator_url && <> — <a href={l.mediator_url} target="_blank" rel="noreferrer">{l.mediator_url}</a></>}
          {" "}(articles L611-1 et suivants du Code de la consommation).</p>
      </section>
      <section>
        <h2>12. Droit applicable</h2>
        <p>Les présentes conditions sont soumises au droit français. Le consommateur peut saisir la juridiction de son
          lieu de résidence ou celle du lieu de l'événement dommageable.</p>
      </section>
      <section>
        <h2>Annexe — Formulaire de rétractation</h2>
        <p>À l'attention de <V value={l.company_name} label="nom ou raison sociale" />, <V value={l.address} label="adresse" />,
          {" "}<V value={l.contact_email} label="adresse e-mail de contact" /> :</p>
        <p>Je vous notifie par la présente ma rétractation du contrat portant sur l'abonnement BreachRadar Premium
          souscrit le [date], avec le compte [adresse e-mail du compte].<br />
          Nom du consommateur : [nom] — Date : [date] — Signature (en cas d'envoi papier).</p>
      </section>
    </Layout>
  );
};

export const Privacy = () => {
  const l = useLegal();
  if (!l) return <Loading title="Politique de confidentialité" />;
  const p = l.processors || {};
  const ai = p.ai === "anthropic" ? "Anthropic PBC (États-Unis)" : p.ai === "emergent" ? "Emergent Labs et le fournisseur de modèle d'IA qu'il utilise (États-Unis)" : null;
  return (
    <Layout title="Politique de confidentialité">
      <section>
        <h2>1. Responsable du traitement</h2>
        <Editor l={l} />
        <p>Pour toute question relative à vos données : <V value={l.contact_email} label="adresse e-mail de contact" />.</p>
      </section>
      <section>
        <h2>2. Données traitées, finalités et bases légales</h2>
        <ul>
          <li><strong>Recherches</strong> : cible saisie (adresse e-mail, domaine ou nom d'utilisateur) et résultats,
            pour fournir le service et vous permettre de retrouver vos recherches. Sans compte, elles sont rattachées à un
            identifiant aléatoire propre à votre navigateur et ne sont visibles que depuis celui-ci. Base légale :
            intérêt légitime à fournir le service demandé ; exécution du contrat si vous avez un compte.</li>
          <li><strong>Compte</strong> : adresse e-mail, mot de passe (stocké uniquement sous forme d'empreinte bcrypt),
            dates de création, de connexion et d'acceptation des CGV. Base légale : exécution du contrat.</li>
          <li><strong>Veille Premium</strong> : adresses surveillées et liste des fuites déjà connues pour chacune, afin
            de détecter les nouvelles et de vous alerter. Base légale : exécution du contrat.</li>
          <li><strong>Abonnement</strong> : formule, statut, échéance et identifiant de l'abonnement chez le prestataire
            de paiement. Vos données bancaires sont traitées exclusivement par ce prestataire. Bases légales :
            exécution du contrat et obligations comptables.</li>
          <li><strong>E-mails</strong> : codes de confirmation, alertes de fuite et information avant renouvellement.
            Seul un compteur quotidien du nombre d'envois est conservé, sans les adresses. Base légale : exécution du
            contrat.</li>
          <li><strong>Vérification de mot de passe</strong> : le mot de passe ne quitte jamais votre appareil. Votre
            navigateur calcule son empreinte SHA-1 et n'envoie que ses cinq premiers caractères directement à Pwned
            Passwords ; ni l'éditeur ni ce service ne reçoivent le mot de passe, et rien n'est conservé.</li>
          <li><strong>Rapport IA</strong> : la cible et les statistiques de fuites (noms des fuites, types de données,
            dates) sont transmises au fournisseur d'IA pour rédiger le rapport. Base légale : intérêt légitime.</li>
          <li><strong>Journaux techniques</strong> (adresse IP, requêtes, erreurs), pour la sécurité et le bon
            fonctionnement du service. Base légale : intérêt légitime.</li>
        </ul>
        <p>Aucune décision automatisée produisant des effets juridiques n'est prise, et aucune donnée n'est vendue ni
          utilisée à des fins publicitaires.</p>
      </section>
      <section>
        <h2>3. Destinataires et sous-traitants</h2>
        <p>Vos données ne sont accessibles qu'à l'éditeur et aux prestataires strictement nécessaires :</p>
        <ul>
          <li>Hébergement : <V value={l.host_name} label="nom de l'hébergeur" /> ;</li>
          <li>XposedOrNot, interrogé avec la cible de la recherche ou l'adresse surveillée ;</li>
          <li>Have I Been Pwned (Pwned Passwords), qui ne reçoit qu'un préfixe d'empreinte ;</li>
          {p.brevo && <li>Brevo (Sendinblue SAS, France), pour l'envoi des e-mails ;</li>}
          {!p.brevo && p.email_host && <li>Le service d'envoi d'e-mails ({p.email_host}) ;</li>}
          {p.stripe && <li>Stripe Payments Europe Ltd (Irlande), pour les paiements par carte ;</li>}
          {p.paypal && <li>PayPal (Europe) S.à r.l. et Cie, S.C.A. (Luxembourg), pour les paiements PayPal ;</li>}
          {ai && <li>{ai}, pour la rédaction des rapports d'analyse.</li>}
        </ul>
      </section>
      <section>
        <h2>4. Transferts hors de l'Union européenne</h2>
        <p>Certains prestataires, notamment le fournisseur d'IA, peuvent traiter des données hors de l'Union
          européenne. Ces transferts sont encadrés par une décision d'adéquation (dont le cadre de protection des
          données UE–États-Unis pour les entreprises certifiées) ou par les clauses contractuelles types de la
          Commission européenne.</p>
      </section>
      <section>
        <h2>5. Durées de conservation</h2>
        <ul>
          <li>Recherches et surveillance sans compte : 6 mois ;</li>
          <li>Recherches, surveillance et veille d'un compte : jusqu'à leur suppression par vous ou celle du compte ;</li>
          <li>Compte non confirmé : 7 jours ; compte sans abonnement inactif depuis 3 ans : supprimé automatiquement ;</li>
          <li>Codes de confirmation : 15 minutes ; compteurs d'envoi d'e-mails et journal d'administration : 13 mois ;</li>
          <li>Pièces comptables liées aux paiements : 10 ans (article L123-22 du Code de commerce) ;</li>
          <li>Journaux techniques : durée limitée par rotation automatique.</li>
        </ul>
      </section>
      <section>
        <h2>6. Sécurité</h2>
        <p>Connexions chiffrées (HTTPS), mots de passe stockés sous forme d'empreinte, secrets de configuration
          chiffrés, base de données non exposée sur Internet, accès d'administration restreints et journalisés.</p>
      </section>
      <section>
        <h2>7. Vos droits</h2>
        <p>Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de
          portabilité, ainsi que du droit de définir des directives sur le sort de vos données après votre décès. Depuis
          « Mon compte », vous pouvez directement <strong>exporter vos données</strong> et <strong>supprimer votre
          compte</strong>. Pour toute autre demande : <V value={l.contact_email} label="adresse e-mail de contact" />.
          Une réponse vous est apportée dans un délai d'un mois.</p>
        <p>Vous pouvez introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr" target="_blank"
          rel="noreferrer">www.cnil.fr</a>).</p>
      </section>
      <section>
        <h2>8. Cookies et traceurs</h2>
        <p>Le site n'utilise ni cookie publicitaire ni outil de mesure d'audience. Il enregistre dans votre navigateur
          (stockage local) uniquement les éléments nécessaires à son fonctionnement : votre session de connexion,
          l'identifiant aléatoire qui rend votre historique privé et le thème d'affichage. Ces traceurs sont exemptés de
          consentement (article 82 de la loi Informatique et Libertés). Les pages de paiement de
          {p.stripe && p.paypal ? " Stripe et PayPal" : p.stripe ? " Stripe" : " PayPal"} peuvent déposer leurs propres
          cookies, régis par leurs politiques.</p>
      </section>
      <section>
        <h2>9. Mineurs</h2>
        <p>La création d'un compte est réservée aux personnes de 15 ans et plus, ou aux plus jeunes avec l'accord de leur
          représentant légal.</p>
      </section>
      <section>
        <h2>10. Modifications</h2>
        <p>Cette politique peut évoluer ; la date de mise à jour figure en haut de la page. En cas de changement
          important, les titulaires d'un compte en sont informés.</p>
      </section>
    </Layout>
  );
};
