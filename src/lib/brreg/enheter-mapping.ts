/**
 * Kobling mellom Brreg-postens felter og kolonnene i reg.enheter.
 * Ren funksjon uten I/O, slik at den kan testes uten database.
 *
 * NB: raw_data lagres IKKE (eksplisitt krav). Bare feltene speilet allerede har.
 */
import { deriveMarkers } from "./enheter-rules";

export interface BrregFullRecord {
  organisasjonsnummer: string;
  navn?: string | null;
  organisasjonsform?: { kode?: string | null; beskrivelse?: string | null } | null;
  naeringskode1?: { kode?: string | null; beskrivelse?: string | null } | null;
  naeringskode2?: { kode?: string | null; beskrivelse?: string | null } | null;
  naeringskode3?: { kode?: string | null; beskrivelse?: string | null } | null;
  antallAnsatte?: number | null;
  harRegistrertAntallAnsatte?: boolean | null;
  forretningsadresse?: BrregAdresse | null;
  postadresse?: BrregAdresse | null;
  institusjonellSektorkode?: { kode?: string | null } | null;
  stiftelsesdato?: string | null;
  registreringsdatoEnhetsregisteret?: string | null;
  konkurs?: boolean | null;
  konkursdato?: string | null;
  underAvvikling?: boolean | null;
  underAvviklingDato?: string | null;
  underTvangsavviklingEllerTvangsopplosning?: boolean | null;
  slettedato?: string | null;
  registrertIForetaksregisteret?: boolean | null;
  registrertIMvaregisteret?: boolean | null;
  registrertIFrivillighetsregisteret?: boolean | null;
  registrertIStiftelsesregisteret?: boolean | null;
  registrertIPartiregisteret?: boolean | null;
  hjemmeside?: string | null;
  epostadresse?: string | null;
  telefon?: string | null;
  mobil?: string | null;
  maalform?: string | null;
  aktivitet?: string[] | string | null;
  vedtektsdato?: string | null;
  vedtektsfestetFormaal?: string[] | string | null;
  sisteInnsendteAarsregnskap?: string | null;
  overordnetEnhet?: string | null;
}

interface BrregAdresse {
  poststed?: string | null;
  postnummer?: string | null;
  kommune?: string | null;
  kommunenummer?: string | null;
}

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.filter(Boolean).join(" ") || null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const dt = (v: unknown): string | null => txt(v);

export function mapRecordToStagingRow(r: BrregFullRecord): Record<string, unknown> {
  const m = deriveMarkers(r);
  const fa = r.forretningsadresse ?? {};
  const pa = r.postadresse ?? {};
  return {
    organisasjonsnummer: r.organisasjonsnummer,
    navn: txt(r.navn),
    organisasjonsform_kode: txt(r.organisasjonsform?.kode),
    organisasjonsform_beskrivelse: txt(r.organisasjonsform?.beskrivelse),
    naeringskode1_kode: txt(r.naeringskode1?.kode),
    naeringskode1_beskrivelse: txt(r.naeringskode1?.beskrivelse),
    naeringskode2_kode: txt(r.naeringskode2?.kode),
    naeringskode2_beskrivelse: txt(r.naeringskode2?.beskrivelse),
    naeringskode3_kode: txt(r.naeringskode3?.kode),
    naeringskode3_beskrivelse: txt(r.naeringskode3?.beskrivelse),
    antall_ansatte: r.antallAnsatte ?? null,
    har_registrert_antall_ansatte: r.harRegistrertAntallAnsatte ?? null,
    forretningsadresse_poststed: txt(fa.poststed),
    forretningsadresse_postnummer: txt(fa.postnummer),
    forretningsadresse_kommune: txt(fa.kommune),
    forretningsadresse_kommunenummer: txt(fa.kommunenummer),
    postadresse_poststed: txt(pa.poststed),
    postadresse_postnummer: txt(pa.postnummer),
    postadresse_kommune: txt(pa.kommune),
    postadresse_kommunenummer: txt(pa.kommunenummer),
    institusjonell_sektorkode: txt(r.institusjonellSektorkode?.kode),
    stiftelsesdato: dt(r.stiftelsesdato),
    registreringsdato_enhetsregisteret: dt(r.registreringsdatoEnhetsregisteret),
    konkurs: r.konkurs ?? false,
    konkursdato: dt(r.konkursdato),
    under_avvikling: r.underAvvikling ?? false,
    under_avvikling_dato: dt(r.underAvviklingDato),
    under_tvangsavvikling_eller_tvangsopplosning:
      r.underTvangsavviklingEllerTvangsopplosning ?? false,
    slettet: Boolean(r.slettedato),
    registrert_i_foretaksregisteret: r.registrertIForetaksregisteret ?? false,
    registrert_i_mvaregisteret: r.registrertIMvaregisteret ?? false,
    registrert_i_frivillighetsregisteret: r.registrertIFrivillighetsregisteret ?? false,
    registrert_i_stiftelsesregisteret: r.registrertIStiftelsesregisteret ?? false,
    registrert_i_partiregisteret: r.registrertIPartiregisteret ?? false,
    hjemmeside: txt(r.hjemmeside),
    epostadresse: txt(r.epostadresse),
    telefon: txt(r.telefon),
    mobil: txt(r.mobil),
    maalform: txt(r.maalform),
    aktivitet: txt(r.aktivitet),
    vedtektsdato: dt(r.vedtektsdato),
    vedtektsfestet_formaal: txt(r.vedtektsfestetFormaal),
    siste_innsendte_aarsregnskap: txt(r.sisteInnsendteAarsregnskap),
    overordnet_enhet: txt(r.overordnetEnhet),
    er_utdanning: m.er_utdanning,
    er_rekruttering: m.er_rekruttering,
    er_offentlig: m.er_offentlig,
    er_i_konsern: m.er_i_konsern,
  };
}
