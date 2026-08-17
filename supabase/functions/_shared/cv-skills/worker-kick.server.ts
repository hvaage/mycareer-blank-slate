/**
 * Vekkesignal til bakgrunnsarbeideren for CV-analyse.
 *
 * Kallet skal ikke avbrytes: arbeideren tar lås og kjører et tidsbudsjett med
 * flere steg. Et kort avbrudd (f.eks. 1,5 s) rakk å kansellere hele slicen, og
 * jobben ble stående i kø uten fremdrift. Her holdes kallet i live uten at den
 * som sender signalet må vente på svaret.
 */
const inflight = new Set<Promise<unknown>>();

export function kickAtomizationWorker(args: {
  baseUrl: string | URL;
  secret: string;
  jobId: string;
}): void {
  const url = new URL("/api/public/cv/atomization-worker", args.baseUrl);
  const work = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cv-worker-secret": args.secret },
    body: JSON.stringify({ jobId: args.jobId }),
  })
    .then(async (res) => {
      // Les og forkast kroppen slik at forbindelsen lukkes ryddig.
      await res.text().catch(() => "");
    })
    .catch(() => {
      // Reaperen henter jobben tilbake i kø ved neste kall.
    });

  const tracked = work.finally(() => inflight.delete(tracked));
  inflight.add(tracked);

  const runtime = globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  };
  if (typeof runtime.EdgeRuntime?.waitUntil === "function") {
    runtime.EdgeRuntime.waitUntil(tracked);
  }
}
