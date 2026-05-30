// @ts-nocheck
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { InstallGuide } from "./install-guide";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton({
  className,
  variant = "ghost",
  showLabel = true,
}: {
  className?: string;
  variant?: "ghost" | "outline" | "default" | "secondary";
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (navigator as any).standalone === true;
    setInstalled(!!standalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome !== "accepted") setOpen(true);
        setDeferred(null);
        return;
      } catch {
        // fall through to dialog
      }
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        variant={variant}
        onClick={handleClick}
        className={className}
        aria-label="Installer karrierenmin.no som app"
      >
        <Download className="h-4 w-4" />
        {showLabel && <span>Installer app</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Installer karrierenmin.no på enheten</DialogTitle>
            <DialogDescription>
              Få raskere tilgang og en app-lignende opplevelse — uten å gå via App Store.
            </DialogDescription>
          </DialogHeader>
          <InstallGuide />
        </DialogContent>
      </Dialog>
    </>
  );
}
