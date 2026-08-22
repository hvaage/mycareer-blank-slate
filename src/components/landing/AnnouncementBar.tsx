

export function AnnouncementBar() {
  return (
    <div className="border-b border-border bg-muted/50">
      <div className="container mx-auto px-4 pl-16 sm:pl-20 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-xs sm:gap-2 sm:py-3 sm:text-sm">
        <p className="text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 mr-2 font-medium text-foreground">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden />
            Under bygging
          </span>
          Lanseres i{" "}
          <span className="font-medium text-foreground">august 2026</span>.
        </p>
      </div>
    </div>
  );
}
