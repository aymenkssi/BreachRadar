import { Radar } from "lucide-react";

export const ScanningState = ({ target }) => (
  <div data-testid="radar-scanning-state" className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card/60 py-20">
    <div className="relative h-48 w-48">
      <div className="absolute inset-0 rounded-full border border-primary/20" />
      <div className="absolute inset-6 rounded-full border border-primary/20" />
      <div className="absolute inset-12 rounded-full border border-primary/20" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Radar className="h-8 w-8 text-primary" />
      </div>
      <div className="radar-sweep absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 h-1/2 w-1/2 origin-top-left"
          style={{ background: "conic-gradient(from 0deg, hsl(var(--primary) / 0.35), transparent 60%)", borderRadius: "0 0 100% 0" }}
        />
      </div>
    </div>
    <p className="mt-8 font-heading text-lg font-semibold text-foreground">Investigation en cours…</p>
    <p className="mt-1 font-mono-x text-sm text-primary">{target}</p>
    <div className="mt-4 space-y-1 text-center text-xs font-mono-x text-muted-foreground">
      <p>› Interrogation des bases de fuites (XposedOrNot)</p>
      <p>› Corrélation des enregistrements exposés</p>
      <p>› Génération du rapport de renseignement IA</p>
    </div>
  </div>
);
