import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const PremiumLock = ({ text, onUpgrade }) => (
  <div className="flex flex-col items-center rounded-xl border border-dashed border-primary/30 bg-primary/5 px-6 py-10 text-center">
    <Crown className="mb-3 h-8 w-8 text-primary" />
    <p className="text-sm text-muted-foreground">{text}</p>
    <Button size="sm" className="mt-4 gap-2" onClick={onUpgrade} data-testid="premium-upgrade-btn">
      <Crown className="h-4 w-4" /> Passer à Premium
    </Button>
  </div>
);
