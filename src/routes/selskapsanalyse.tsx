import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/selskapsanalyse")({
  component: SelskapsanalyseLayout,
});

function SelskapsanalyseLayout() {
  return <Outlet />;
}