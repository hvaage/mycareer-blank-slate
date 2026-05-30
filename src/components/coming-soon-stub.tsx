// @ts-nocheck
import type { LucideIcon } from "lucide-react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  features: string[];
}

export function ComingSoonStub({ icon: Icon, title, description, features }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex flex-col items-center text-center space-y-6 py-12">
        <div className="rounded-full bg-muted p-6">
          <Icon className="h-12 w-12 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground max-w-lg whitespace-pre-line">{description}</p>
        </div>
        {features.length > 0 && (
          <div className="w-full max-w-md text-left bg-muted/40 rounded-lg p-5 space-y-2">
            <h2 className="text-sm font-semibold">Funksjoner som kommer:</h2>
            <ul className="space-y-1.5">
              {features.map((f) => (
                <li key={f} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button
          onClick={() => toast.success("Vi gir beskjed når funksjonen er klar.")}
        >
          <Bell className="h-4 w-4 mr-2" /> Varsle meg
        </Button>
      </div>
    </div>
  );
}
