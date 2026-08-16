# Claim-typer

Hvordan vi klassifiserer påstander (claims) i AI-generert CV-tekst.

## Hard claims

Spesifikke, etterprøvbare fakta. Skal matches eksakt mot atoms.

### Tallclaims

| Eksempel i tekst | Hva ekstraheres |
|---|---|
| `USD 45 mill.` | beløp=45, valuta=USD, enhet=mill |
| `27 ansatte` | tall=27, type=team_size |
| `40 % vekst` | tall=40, type=percent, kontekst=growth |
| `2,5x ARR` | multiplikator=2.5, type=multiple |
| `NOK 100 mill. budsjett` | beløp=100, valuta=NOK, enhet=mill, type=budget |

### Datoclaims

| Eksempel | Hva ekstraheres |
|---|---|
| `2019–2024` | start_year=2019, end_year=2024 |
| `i løpet av 5 år` | varighet=5, enhet=år |
| `siden 2015` | start_year=2015 |
| `Q3 2023` | kvartal=3, år=2023 |

### Entitet-claims

| Eksempel | Hva ekstraheres |
|---|---|
| `Cisco Systems Norge` | selskap |
| `Universitetet i Oslo` | institusjon |
| `MEDDPICC-sertifisert` | sertifikat |
| `Salesforce` | tool/teknologi |

### Posisjon-claims

| Eksempel | Hva ekstraheres |
|---|---|
| `COO for Cisco Norge` | rolle=COO, selskap=Cisco Norge |
| `rapporterte til CEO` | reporting_line=CEO |
| `medlem av ledergruppen` | organizational=leadership team |

## Soft claims

Beskrivende eller kontekstuelle påstander. Krever semantisk match.

### Verb-baserte

| Eksempel | Hva må verifiseres |
|---|---|
| `etablerte ny salgsorganisasjon` | finnes en achievement med "etablering" eller "build" som tema? |
| `transformerte forretningsmodellen` | finnes "transformation"-relatert achievement? |
| `ledet kulturendring` | finnes ledelses-achievement med endring eller kultur-tema? |

### Egenskap-påstander

| Eksempel | Hva må verifiseres |
|---|---|
| `strategisk tenker` | nevnt i atoms som styrke eller demonstrert i achievements? |
| `hands-on lederstil` | nevnt eller demonstrert? |
| `internasjonal erfaring` | finnes det atoms med utenlandsk lokasjon eller globalt scope? |

## Ikke-claims

Tekst som ikke trenger verifikasjon:

- Generelle innledninger ("Jeg er en erfaren leder…")
- Stilistiske formuleringer ("med fokus på vekst og verdiskaping")
- Kjent industri-terminologi ("med MEDDPICC som rammeverk")

## Match-strategier

### Eksakt-match (for hard claims)

For tall: ±5% toleranse for avrunding (45 mill. matcher 47 mill.). For datoer:
år-presisjon. For entiteter: case-insensitive normalized string match.

### Semantisk match (for soft claims)

To-pass:

1. **Lokal lettvekts:** Jaccard-similaritet mellom claim-tekst og atom-content (`content_no` eller `content_en`). Gir match hvis similaritet ≥ 0.4.

2. **LLM-judge (full mode):** Claude API får påstanden og kandidat-atoms (de mest like) og svarer JA/NEI/USIKKER med begrunnelse.

## Spesifikke regler

### Avrunding

Avrunding er **OK** når:
- Atom: `27 ansatte`, claim: `nesten 30 ansatte` → OK
- Atom: `USD 45 mill.`, claim: `USD 45 mill.` → OK
- Atom: `USD 45 mill.`, claim: `over 40 mill.` → OK

Avrunding er **IKKE OK** når:
- Atom: `27 ansatte`, claim: `over 50 ansatte` → for stort sprang
- Atom: `USD 45 mill.`, claim: `USD 100 mill.` → mer enn dobbel
- Atom: `vekst på 40 %`, claim: `mer enn doblet seg` → kvalitativ overdrivelse

Tommelfingerregel: avrunding ≤ 20 % i samme retning som tallet, og samme størrelsesorden.

### Sammenstilling

AI har lov til å:
- Sammenstille flere atoms i én bullet
- Omformulere på samme språk
- Oversette mellom NO og EN
- Bruke synonymer

AI har **ikke** lov til å:
- Legge til årsakssammenheng som ikke er beskrevet
- Tilskrive prestasjon til kandidaten alene når atom sier "team"
- Promotere fra "bidro" til "ledet"

### Tom kontekst

Hvis atom mangler felt:
- Atom har ikke `scope_team_size`, men claim sier "ledet team på 50" → unverified, ikke contradicted (informasjonen er bare ikke der)
- Atom har `scope_team_size: 27`, claim sier "team på 50" → contradicted
- Atom har `scope_team_size: 27`, claim sier "team" (ingen tall) → verified

Manglende presisjon i claim er OK, mismatch i presisjon er ikke OK.
