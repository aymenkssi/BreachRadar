import { useState } from "react";
import { Search, Loader2, Radar, AtSign, Globe, User } from "lucide-react";
import { Button } from "@/components/ui/button";

const PRESETS = [
  { label: "test@example.com", type: "email" },
  { label: "adobe.com", type: "domain" },
  { label: "linkedin.com", type: "domain" },
];

const detectType = (t) => {
  const v = t.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "email";
  if (/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(v)) return "domain";
  return v ? "username" : null;
};

const TYPE_META = {
  email: { icon: AtSign, label: "Adresse email" },
  domain: { icon: Globe, label: "Domaine" },
  username: { icon: User, label: "Nom d'utilisateur" },
};

export const SearchBar = ({ onSearch, loading }) => {
  const [value, setValue] = useState("");
  const type = detectType(value);
  const Meta = type ? TYPE_META[type] : null;

  const submit = (e) => {
    e?.preventDefault();
    if (value.trim() && !loading) onSearch(value.trim());
  };

  return (
    <div data-testid="investigation-search-bar" className="w-full">
      <form onSubmit={submit} className="relative">
        <div className="group relative flex items-center rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-xl transition-all focus-within:border-primary/60 focus-within:shadow-primary/10">
          <div className="pl-4 text-muted-foreground sm:pl-5">
            {Meta ? <Meta.icon className="h-5 w-5 text-primary" /> : <Search className="h-5 w-5" />}
          </div>
          <input
            data-testid="investigation-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Entrez un email, un domaine ou un nom d'utilisateur à investiguer…"
            className="font-mono-x min-w-0 flex-1 bg-transparent px-3 py-5 text-sm outline-none placeholder:text-muted-foreground/60 sm:px-4 sm:text-base"
          />
          {Meta && (
            <span className="mr-2 hidden sm:inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Meta.icon className="h-3.5 w-3.5" /> {Meta.label}
            </span>
          )}
          <Button
            type="submit"
            data-testid="investigate-btn"
            aria-label="Investiguer"
            disabled={loading || !value.trim()}
            className="m-2 h-12 flex-shrink-0 rounded-xl px-4 font-heading font-semibold sm:px-6"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin min-[420px]:mr-2" /><span className="hidden min-[420px]:inline">Analyse…</span></>
            ) : (
              <><Radar className="h-4 w-4 min-[420px]:mr-2" /><span className="hidden min-[420px]:inline">Investiguer</span></>
            )}
          </Button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono-x uppercase tracking-wider text-muted-foreground">Essais rapides :</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            data-testid={`preset-${p.label}`}
            disabled={loading}
            onClick={() => { setValue(p.label); onSearch(p.label); }}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs font-mono-x text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
};
