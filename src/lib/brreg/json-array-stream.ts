/**
 * Inkrementell splitter for et stort JSON-array som kommer som en strøm.
 * Fullfilen fra Brreg er ~209 MB komprimert og kan ikke leses inn i minnet i
 * én operasjon i en Worker. Denne funksjonen finner toppnivåobjektene ett og
 * ett ved å telle klammer, med strenger og escapes håndtert.
 */
export function createJsonArrayScanner() {
  let buf = "";
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let started = false;

  return {
    /** Mater inn en tekstbit og returnerer de komplette objektene den ga. */
    push(chunk: string): string[] {
      buf += chunk;
      const out: string[] = [];
      for (let i = 0; i < buf.length; i++) {
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
      // Behold bare halen som ennå ikke er ferdig lest.
      if (depth > 0 && start >= 0) {
        buf = buf.slice(start);
        start = 0;
      } else {
        buf = "";
        start = -1;
      }
      return out;
    },
  };
}
