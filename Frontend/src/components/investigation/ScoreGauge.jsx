import { useEffect, useState } from "react";
import { scoreColor, riskInfo } from "@/lib/format";

export const ScoreGauge = ({ score, riskLabel }) => {
  const [display, setDisplay] = useState(0);
  const color = scoreColor(score);
  const info = riskInfo(riskLabel);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = display;
    const animate = (now) => {
      const p = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (score - from) * eased));
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [score]);

  const R = 80;
  const CIRC = Math.PI * R; // semicircle
  const offset = CIRC * (1 - display / 100);

  return (
    <div data-testid="compromise-score-gauge" className="flex flex-col items-center">
      <div className="relative">
        <svg width="220" height="130" viewBox="0 0 220 130">
          <path
            d="M 20 120 A 90 90 0 0 1 200 120"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path
            d="M 20 120 A 90 90 0 0 1 200 120"
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.1s linear", filter: `drop-shadow(0 0 8px ${color}80)` }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <span className="font-mono-x text-5xl font-extrabold tracking-tight" style={{ color }}>
            {display}
          </span>
          <span className="text-xs font-mono-x uppercase tracking-widest text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div
        className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="pulse-ring absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: color }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        </span>
        {info.label}
      </div>
    </div>
  );
};
