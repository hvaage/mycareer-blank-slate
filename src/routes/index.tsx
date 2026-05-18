import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Karrierenmin.no" },
      { name: "description", content: "Karrierenmin.no – din karriereplattform." },
    ],
  }),
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-foreground">Karrierenmin.no</h1>
        <p className="mt-4 text-muted-foreground">Klar for å bygge din karriereplattform.</p>
      </div>
    </main>
  );
}
