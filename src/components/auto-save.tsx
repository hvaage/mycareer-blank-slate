// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Check, Loader2 } from "lucide-react";

type Status = "idle" | "saving" | "saved" | "error";

function useDebouncedSave(value: string, save: (v: string) => Promise<void>, delay = 1500) {
  const [status, setStatus] = useState<Status>("idle");
  const initial = useRef(value);
  const last = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (value === initial.current && value === last.current) return;
    if (value === last.current) return;
    last.current = value;
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await save(value);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } catch {
        setStatus("error");
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, save, delay]);

  return status;
}

function StatusIndicator({ status }: { status: Status }) {
  if (status === "saving")
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Lagrer…
      </span>
    );
  if (status === "saved")
    return (
      <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
        <Check className="h-3 w-3" /> Lagret
      </span>
    );
  if (status === "error")
    return <span className="text-xs text-destructive">Lagring feilet</span>;
  return null;
}

export function AutoSaveTextarea({
  value: initialValue,
  onSave,
  label,
  rows = 4,
  placeholder,
}: {
  value: string | null | undefined;
  onSave: (v: string) => Promise<void>;
  label?: string;
  rows?: number;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);
  const status = useDebouncedSave(value, onSave);
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{label}</label>
          <StatusIndicator status={status} />
        </div>
      )}
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    </div>
  );
}

export function AutoSaveInput({
  value: initialValue,
  onSave,
  label,
  placeholder,
}: {
  value: string | null | undefined;
  onSave: (v: string) => Promise<void>;
  label?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);
  const status = useDebouncedSave(value, onSave);
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{label}</label>
          <StatusIndicator status={status} />
        </div>
      )}
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
