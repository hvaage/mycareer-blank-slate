# AI-tells: klisjéer som avslører maskinell opprinnelse

Mønstre som typisk dukker opp i AI-generert tekst, og som skal flagges
av `checks/ai-tells.ts`. Listen er ikke utømmende og oppdateres når nye
mønstre observeres i bruk.

## Norsk

### Generiske resultat-fraser

- `har spilt en avgjørende rolle`
- `har bidratt til betydelig`
- `har vært sentral i`
- `er en bidragsyter`
- `har skapt verdi`
- `gjennom strategisk arbeid`
- `gjennom fokusert innsats`
- `med god kost-nytte`

### Strategiske buzzwords

- `i tråd med strategiske målsettinger`
- `i samsvar med organisasjonens visjon`
- `på en bærekraftig måte`
- `gjennom datadreven beslutningstaking`
- `med en helhetlig tilnærming`
- `på en proaktiv måte`
- `på en strukturert måte`

### Transformasjons-klisjéer

- `transformerte landskapet`
- `revolusjonerte måten`
- `endret spillet`
- `disruptiv tilnærming`
- `paradigme-skifte`

### Vage forsterkere

- `betydelig vekst`
- `omfattende erfaring`
- `bred kompetanse`
- `solid bakgrunn`
- `dyp innsikt`

(Disse er **vage** uten konkrete tall — flagges som svake.)

### Engelske leddstrukturer i norsk tekst

- `som driver` (uten objekt) — direkte oversettelse av "as a driver"
- `på tvers av` (overforbruk) — engelsk-isme fra "across"
- `levere på` — engelsk-isme fra "deliver on"

## Engelsk

### Generic over-promising

- `passionate about`
- `dedicated to excellence`
- `committed to driving`
- `proven track record of`
- `results-driven`
- `detail-oriented`
- `team player`
- `synergize`
- `move the needle`
- `take ownership`

### Buzzword-stacking

- `data-driven decision making`
- `cross-functional collaboration`
- `best-in-class solutions`
- `customer-centric approach`
- `agile methodologies`
- `innovative solutions`
- `cutting-edge technology`
- `world-class`
- `enterprise-grade`

### Transformation-clichés

- `transformed the landscape`
- `disrupted the industry`
- `revolutionized the approach`
- `paradigm shift`
- `game-changer`

## Hvorfor disse er problematiske

1. **De sier ingenting konkret.** En leser kan ikke skille deg fra andre kandidater basert på "har spilt en avgjørende rolle".
2. **De signalerer at teksten er generert.** Rekrutterer som har lest tusenvis av AI-CV-er gjenkjenner mønsteret umiddelbart.
3. **De erstatter konkrete tall.** Når en kandidat skriver "betydelig vekst" istedenfor "40 % YoY", er det ofte fordi atom-en mangler tall — og da er fluff dårligere enn ingenting.
4. **De er gjettbart oversatt.** Mange er direkte oversettelser fra engelsk og lyder ikke naturlig på norsk.

## Severity

Alle AI-tells flagges som `critical` eller `important`:

| Mønster | Severity |
|---|---|
| `transformerte landskapet`, `revolusjonerte`, `paradigme-skifte` | critical |
| `har spilt en avgjørende rolle`, `passionate about` | critical |
| `i tråd med strategiske målsettinger`, `data-driven decision making` | important |
| `betydelig vekst` (uten tall), `proven track record` | important |

`critical` betyr at bulletten er sannsynligvis dårlig nok til at brukeren
bør få sterk anbefaling om å omformulere. `important` er svakere — bulletten
er ikke helt slem, men kan klart forbedres.

## Hva gjøres med flagget tekst

Skill-en flagger og foreslår — den endrer ikke tekst automatisk.

For hvert flagg returneres:
- `severity`
- `category` (alltid `ai_tell`)
- `message` (forklaring til brukeren)
- `suggestion` (hvis mulig: en konkret omformulering, basert på regel-tabell)

Den endelige avgjørelsen om endring tas av brukeren eller av en
LLM-rewrite-pass (kalt eksplisitt med `suggestRewrite()`).
