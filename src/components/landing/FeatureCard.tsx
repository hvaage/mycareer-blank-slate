import type { LucideIcon } from "lucide-react";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 transition-colors hover:border-accent/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
