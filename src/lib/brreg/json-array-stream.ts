/**
 * Inkrementell splitter for et stort JSON-array som kommer som en strøm.
 * Fullfilen fra Brreg er ~209 MB komprimert og kan ikke leses inn i minnet i
 * én operasjon. Denne funksjonen finner toppnivåobjektene ett og ett ved å
 * telle klammer, med strenger og escapes håndtert.
 *
 * TO INVARIANTER SOM MÅ HOLDE (begge ble brutt i første versjon):
 *  1. Hvert tegn skannes nøyaktig én gang. Skanningen starter der forrige
 *     bit sluttet, ikke på posisjon null. Uten dette blir kostnaden
 *     kvadratisk med filstørrelsen.
 *  2. En beholdt hale skannes ikke om igjen. Tilstandsflaggene (depth,
 *     inString, escaped) lever på tvers av bitene, så en ny skanning av
 *     samme tegn ville telt klammene to ganger og ødelagt oppdelingen.
 */
export function createJsonArrayScanner() {
  let buf = "";
  /** Neste uskannede posisjon i buf. Invariant 1. */
  let pos = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let started = false;
  /** Totalt antall tegn matet inn. */
  let fed = 0;

  return {
    /**
     * Antall tegn som trygt kan regnes som ferdig lest: alt som er matet inn
     * minus halen som fortsatt ligger i bufferet. Halen kan være et halvlest
     * objekt, så en gjenopptaking MÅ skje på denne posisjonen — ikke på
     * bitgrensen, som nesten alltid ligger midt inne i et objekt.
     */
    committedChars(): number {
      return fed - buf.length;
    },
    /** Mater inn en tekstbit og returnerer de komplette objektene den ga. */
    push(chunk: string): string[] {
      fed += chunk.length;
      buf += chunk;
      const out: string[] = [];
      for (let i = pos; i < buf.length; i++) {

        const c = buf[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') {
          inString = true;
          continue;
        }
        if (c === "[" && !started && depth === 0) {
          started = true;
          continue;
        }
        if (c === "{") {
          if (depth === 0) start = i;
          depth++;
          continue;
        }
        if (c === "}") {
          depth--;
          if (depth === 0 && start >= 0) {
            out.push(buf.slice(start, i + 1));
            start = -1;
          }
        }
      }
      pos = buf.length;

      // Behold bare halen som ennå ikke er ferdig lest, og flytt markørene
      // med samme forskyvning. Invariant 2.
      const keepFrom = depth > 0 && start >= 0 ? start : pos;
      if (keepFrom > 0) {
        buf = buf.slice(keepFrom);
        pos -= keepFrom;
        if (start >= 0) start -= keepFrom;
      }
      return out;
    },
  };
}
