// @ts-nocheck
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  disabled?: boolean;
  onFile: (file: File, error?: string) => void;
}

export function CvDropzone({ disabled, onFile }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function validate(file: File): string | undefined {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") return "unsupported_format";
    if (file.size > MAX_BYTES) return "file_too_large";
    return undefined;
  }

  function handleFile(file: File) {
    const err = validate(file);
    onFile(file, err);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
        over ? "border-primary bg-primary/5" : "border-muted-foreground/25",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
      <p className="text-sm font-medium mb-1">Dra og slipp CV her</p>
      <p className="text-xs text-muted-foreground mb-3">PDF eller DOCX, maks 10 MB</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="text-sm text-primary hover:underline"
      >
        eller velg fil fra maskinen
      </button>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
