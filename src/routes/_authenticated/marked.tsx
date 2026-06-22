import { createFileRoute } from "@tanstack/react-router";
import { CareerExplorer } from "@/components/market/CareerExplorer";

export const Route = createFileRoute("/_authenticated/marked")({
  component: MarkedPage,
});

function MarkedPage() {
  return <CareerExplorer />;
}
