export function AnnouncementBar() {
  return (
    <div className="bg-[var(--km-paper-warm)]">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-[13px]">
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-[var(--km-blue)]"
          aria-hidden
        />
        <p className="text-[var(--km-ink-soft)]">
          <span className="font-medium text-[var(--km-ink)]">Under bygging</span>
          {" — "}Lanseres i{" "}
          <span className="font-medium text-[var(--km-ink)]">september 2026</span>.
        </p>
      </div>
    </div>
  );
}
