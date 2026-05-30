import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "saving" | "saved" | "error";

export function InlineEdit({
  value,
  onSave,
  className,
  placeholder,
  required,
  label,
  successMessage,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown>;
  className?: string;
  placeholder?: string;
  required?: boolean;
  label?: string;
  successMessage?: string;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!focused && local !== value && status !== "saving") {
    setLocal(value);
  }

  const commit = async (raw: string) => {
    if (savingRef.current) return;
    const v = raw.trim();
    if (required && !v) {
      setLocal(value);
      return;
    }
    if (v === (value ?? "")) return; // No change → no API call
    savingRef.current = true;
    setStatus("saving");
    try {
      await onSave(v);
      setStatus("saved");
      toast.success(successMessage ?? `${label ?? "Felt"} lagret`);
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err: any) {
      setStatus("error");
      toast.error(err?.message ?? "Kunne ikke lagre");
      setLocal(value);
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
        value={local}
        disabled={status === "saving"}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setLocal(value); // revert
            setFocused(false);
            inputRef.current?.blur();
          }
        }}
        onBlur={async (e) => {
          setFocused(false);
          await commit(e.target.value);
        }}
        className={cn("pr-8", className)}
        placeholder={placeholder}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
        {status === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
        {status === "saved" && <Check className="h-4 w-4 text-emerald-600" />}
      </span>
    </div>
  );
}
