import { describe, it, expect } from "vitest";
import { regnskapRad, sampleOk } from "./regnskap-sync.normalize";

const sampleVanlig = {
  id: 12345678,
  journalnr: "JNL-1",
  regnskapstype: "SELSKAP",
  regnskapDokumenttype: "AARSREGNSKAP",
  regnskapsperiode: { fraDato: "2023-01-01", tilDato: "2023-12-31" },
  virksomhet: { morselskap: false },
  resultatregnskapResultat: {
    driftsresultat: {
      driftsinntekter: { sumDriftsinntekter: 100_000_000 },
      driftsresultat: 12_000_000,
      driftskostnad: { sumDriftskostnad: 88_000_000 },
    },
    aarsresultat: 9_500_000,
    finansresultat: {
      finansinntekt: { sumFinansinntekter: 500_000 },
      finanskostnad: { sumFinanskostnad: 300_000 },
    },
  },
  egenkapitalGjeld: {
    egenkapital: { sumEgenkapital: 30_000_000 },
    gjeldOversikt: { sumGjeld: 20_000_000 },
    sumEgenkapitalGjeld: 50_000_000,
  },
  eiendeler: {
    sumEiendeler: 50_000_000,
    omloepsmidler: { sumOmloepsmidler: 20_000_000 },
    anleggsmidler: { sumAnleggsmidler: 30_000_000 },
  },
  valuta: "NOK",
  oppstillingsplan: "GENERELL",
  regnkapsprinsipper: { smaaForetak: false, regnskapsregler: "REGNSKAPSLOVEN" },
  revisjon: { ikkeRevidertAarsregnskap: false, fravalgRevisjon: false },
};

const sampleSmaa = {
  id: 22,
  regnskapsperiode: { fraDato: "2022-01-01", tilDato: "2022-12-31" },
  resultatregnskapResultat: {
    driftsresultat: { driftsinntekter: { sumDriftsinntekter: 2_000_000 }, driftsresultat: 100_000 },
    aarsresultat: 80_000,
  },
  regnkapsprinsipper: { smaaForetak: true, regnskapsregler: "SMAFORETAK" },
  revisjon: { fravalgRevisjon: true },
};

const sampleAvvikling = {
  regnskapsperiode: { fraDato: "2021-01-01", tilDato: "2021-06-30" },
  avviklingsregnskap: true,
  resultatregnskapResultat: { aarsresultat: -500_000 },
};

describe("regnskapRad", () => {
  it("mapper vanlig selskap", () => {
    const r = regnskapRad("123456789", sampleVanlig);
    expect(r).toMatchSnapshot();
    expect(r.raw_data).toBeNull();
    expect(r.regnskapsaar).toBe(2023);
    expect(r.driftsinntekter).toBe(100_000_000);
    expect(r.smaa_foretak).toBe(false);
    expect(r.regnskapsregler).toBe("REGNSKAPSLOVEN");
  });

  it("mapper småforetak m/fravalg revisjon", () => {
    const r = regnskapRad("987654321", sampleSmaa);
    expect(r.smaa_foretak).toBe(true);
    expect(r.fravalg_revisjon).toBe(true);
    expect(r.regnskapsaar).toBe(2022);
    expect(r).toMatchSnapshot();
  });

  it("mapper avviklingsregnskap m/manglende felter", () => {
    const r = regnskapRad("555555555", sampleAvvikling);
    expect(r.avviklingsregnskap).toBe(true);
    expect(r.driftsinntekter).toBeNull();
    expect(r.aarsresultat).toBe(-500_000);
    expect(r.valuta).toBe("NOK");
    expect(r.regnskapstype).toBe("SELSKAP");
    expect(r).toMatchSnapshot();
  });

  it("returnerer null regnskapsaar når tilDato mangler", () => {
    const r = regnskapRad("111", {});
    expect(r.regnskapsaar).toBeNull();
  });
});

describe("sampleOk", () => {
  it("er deterministisk", () => {
    expect(sampleOk("123456789")).toBe(sampleOk("123456789"));
  });
});
