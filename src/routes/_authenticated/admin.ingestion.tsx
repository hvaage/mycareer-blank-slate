import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { IngestionPanel } from "@/components/admin/IngestionPanel";

export const Route = createFileRoute("/_authenticated/admin/ingestion")({
  head: () => ({
    meta: [
      { title: "Admin · Datainntak — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminIngestion,
});

function AdminIngestion() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-foreground">Datainntak</h1>
        <IngestionPanel />
      </main>
      <Footer />
    </div>
  );
}
