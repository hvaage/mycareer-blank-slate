/**
 * Oppslag for engelske CxO-forkortelser mot norske stillingstitler i ESCO.
 *
 * Hensikten er å unngå at KI-forslag tolker en forkortelse feil
 * (f.eks. CCO → IKT-sikkerhet). Mappingen er autoritativ for eksakte
 * forkortelser; brukeren bekrefter likevel selv valget i UI-et.
 */

export type CxoMapping = {
  /** Forkortelse, alltid store bokstaver uten punktum. */
  abbreviation: string;
  /** Full engelsk tittel. */
  expanded: string;
  /** Tilsvarende norsk stillingstittel i ESCO. */
  norwegianTitle: string;
  /** ESCO-URI for yrket. */
  escoUri: string;
  /** Kort begrunnelse på norsk. */
  reasonNb: string;
};

const MAPPINGS: CxoMapping[] = [
  {
    abbreviation: "CEO",
    expanded: "Chief Executive Officer",
    norwegianTitle: "administrerende direktør",
    escoUri: "http://data.europa.eu/esco/occupation/6c3fd65e-2d24-47d8-bc22-9e93512bdcc2",
    reasonNb: "CEO = administrerende direktør / daglig leder.",
  },
  {
    abbreviation: "CFO",
    expanded: "Chief Financial Officer",
    norwegianTitle: "økonomisjef",
    escoUri: "http://data.europa.eu/esco/occupation/30f3ea93-882a-4525-841c-1d5b4b64076f",
    reasonNb: "CFO = økonomisjef med ansvar for finans og økonomistyring.",
  },
  {
    abbreviation: "COO",
    expanded: "Chief Operating Officer",
    norwegianTitle: "driftsdirektør",
    escoUri: "http://data.europa.eu/esco/occupation/c64a6e4e-5b38-4f93-b26d-aded817aeaf3",
    reasonNb: "COO = driftsdirektør med ansvar for daglig drift.",
  },
  {
    abbreviation: "CTO",
    expanded: "Chief Technology Officer",
    norwegianTitle: "sjefstekniker",
    escoUri: "http://data.europa.eu/esco/occupation/7b1b5da8-573a-49bb-a38e-68725a949f4f",
    reasonNb: "CTO = teknologisjef / sjefstekniker.",
  },
  {
    abbreviation: "CIO",
    expanded: "Chief Information Officer",
    norwegianTitle: "informasjonsdirektør",
    escoUri: "http://data.europa.eu/esco/occupation/82f90e87-de92-4678-adae-61d3e5f7e1e4",
    reasonNb: "CIO = informasjonsdirektør med ansvar for IT og informasjon.",
  },
  {
    abbreviation: "CISO",
    expanded: "Chief Information Security Officer",
    norwegianTitle: "sjef for IKT-sikkerhet",
    escoUri: "http://data.europa.eu/esco/occupation/276ba420-ef09-4a0e-b215-2c2e2f80ad28",
    reasonNb: "CISO = sjef for IKT-sikkerhet.",
  },
  {
    abbreviation: "CMO",
    expanded: "Chief Marketing Officer",
    norwegianTitle: "marketingsjef",
    escoUri: "http://data.europa.eu/esco/occupation/0ddbf393-38f1-4c22-b14c-fe775008f321",
    reasonNb: "CMO = marketingsjef / markedsdirektør.",
  },
  {
    abbreviation: "CRO",
    expanded: "Chief Revenue Officer",
    norwegianTitle: "salgsdirektør",
    escoUri: "http://data.europa.eu/esco/occupation/2d3d7188-47ab-49b9-9045-e452d9db06f1",
    reasonNb: "CRO = salgsdirektør med ansvar for inntekt og vekst.",
  },
  {
    abbreviation: "CCO",
    expanded: "Chief Commercial Officer",
    norwegianTitle: "salgsdirektør",
    escoUri: "http://data.europa.eu/esco/occupation/2d3d7188-47ab-49b9-9045-e452d9db06f1",
    reasonNb: "CCO = Chief Commercial Officer, tilsvarende salgsdirektør / kommersiell direktør.",
  },
  {
    abbreviation: "CHRO",
    expanded: "Chief Human Resources Officer",
    norwegianTitle: "personalsjef",
    escoUri: "http://data.europa.eu/esco/occupation/f605bcd2-90b6-45a0-a558-d05016d68a77",
    reasonNb: "CHRO = personalsjef / HR-direktør.",
  },
  {
    abbreviation: "CPO",
    expanded: "Chief Product Officer",
    norwegianTitle: "produktsjef",
    escoUri: "http://data.europa.eu/esco/occupation/8a0afc76-4a09-449a-9e7b-a33495889f95",
    reasonNb: "CPO = produktsjef med ansvar for produktstrategi.",
  },
  {
    abbreviation: "CDO",
    expanded: "Chief Data Officer",
    norwegianTitle: "datasjef",
    escoUri: "http://data.europa.eu/esco/occupation/e297ec12-4712-40a4-ad98-ba004cacb205",
    reasonNb: "CDO = datasjef med ansvar for data og analyse.",
  },
  {
    abbreviation: "CLO",
    expanded: "Chief Legal Officer",
    norwegianTitle: "bedriftsjurist",
    escoUri: "http://data.europa.eu/esco/occupation/fdfce14e-992d-4ff4-9f9d-7a353c75654e",
    reasonNb: "CLO = bedriftsjurist / juridisk direktør.",
  },
];

const BY_ABBREVIATION = new Map(MAPPINGS.map((m) => [m.abbreviation, m]));

function normalizeInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[.\s]+/g, "");
}

/**
 * Sjekk om teksten er en kjent CxO-forkortelse (f.eks. "CCO").
 * Returnerer mappingen hvis den finnes, ellers null.
 */
export function lookupCxO(input: string): CxoMapping | null {
  const key = normalizeInput(input);
  if (!key) return null;
  return BY_ABBREVIATION.get(key) ?? null;
}

/**
 * Alle mappinger, nyttig for validering og visning.
 */
export function getAllCxOMappings(): readonly CxoMapping[] {
  return MAPPINGS;
}
