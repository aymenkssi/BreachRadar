import { useEffect, useState } from "react";
import { ShieldAlert, Crosshair, Target, ClipboardCheck, Zap, Sparkles, FileDown, Loader2, Wand2 } from "lucide-react";
import { riskInfo } from "@/lib/format";
import { generateReportPdf } from "@/lib/pdf";
import { Button } from "@/components/ui/button";

const useTypewriter = (text, speed = 8) => {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return out;
};

const Section = ({ icon: Icon, title, children, accent }) => (
  <div className="rounded-xl border border-border bg-background/40 p-4">
    <div className="mb-2 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${accent}`} />
      <h4 className="font-heading text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h4>
    </div>
    {children}
  </div>
);

const List = ({ items, marker }) => (
  <ul className="space-y-2">
    {items.map((it, i) => (
      <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: marker }} />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

export const AiReportPanel = ({ investigation, onGenerate, generating }) => {
  const report = investigation.ai_report || {};
  const aiGenerated = investigation.ai_generated;
  const info = riskInfo(report.threat_level);
  const summary = useTypewriter(aiGenerated ? report.executive_summary : "");
  const done = summary.length >= (report.executive_summary?.length || 0);

  return (
    <div data-testid="ai-risk-report-panel" className="flex h-full flex-col rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-xl">
      <div className="flex items-center justify-between border-b border-border p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-heading text-base font-semibold leading-tight">Rapport de Renseignement IA</h3>
            <p className="text-xs font-mono-x text-muted-foreground">Analyse générée par IA</p>
          </div>
        </div>
        {aiGenerated && (
          <Button variant="outline" size="sm" data-testid="export-report-btn" onClick={() => generateReportPdf(investigation)} className="gap-1.5">
            <FileDown className="h-4 w-4" /> PDF
          </Button>
        )}
      </div>

      {!aiGenerated ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h4 className="font-heading text-lg font-semibold">Rapport IA non généré</h4>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Générez l'analyse de renseignement complète pour cette cible.</p>
          </div>
          <Button data-testid="generate-report-btn" onClick={onGenerate} disabled={generating} className="gap-2">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Génération…</> : <><Sparkles className="h-4 w-4" /> Générer le rapport IA</>}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 overflow-y-auto p-5">
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ color: info.color, background: `${info.color}14`, border: `1px solid ${info.color}33` }}
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="pulse-ring absolute inline-flex h-full w-full rounded-full" style={{ background: info.color }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: info.color }} />
            </span>
            Niveau de menace : {info.label}
          </div>

          <Section icon={ShieldAlert} title="Synthèse exécutive" accent="text-primary">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {summary}
              {!done && <span className="cursor-blink ml-0.5 text-primary">▌</span>}
            </p>
          </Section>

          {report.attack_vectors?.length > 0 && (
            <Section icon={Crosshair} title="Vecteurs d'attaque" accent="text-orange-500">
              <List items={report.attack_vectors} marker="#F97316" />
            </Section>
          )}

          {report.data_exposure_analysis && (
            <Section icon={Target} title="Analyse de l'exposition" accent="text-amber-500">
              <p className="text-sm leading-relaxed text-muted-foreground">{report.data_exposure_analysis}</p>
            </Section>
          )}

          {report.immediate_actions?.length > 0 && (
            <Section icon={Zap} title="Actions immédiates" accent="text-red-500">
              <List items={report.immediate_actions} marker="#EF4444" />
            </Section>
          )}

          {report.recommendations?.length > 0 && (
            <Section icon={ClipboardCheck} title="Recommandations" accent="text-emerald-500">
              <List items={report.recommendations} marker="#10B981" />
            </Section>
          )}
        </div>
      )}
    </div>
  );
};
