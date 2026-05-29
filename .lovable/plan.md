## Mål

Erstatte innholdet på eksisterende `/personvern` med en personvernerklæring tilpasset karrierenmin-tjenesten.

## Endringer

**`src/routes/personvern.tsx`** — erstatt innholdet (én fil, ingen andre endringer):

- Beholder eksisterende layout (Header + Footer + `prose`-styling) og `head()`-struktur.
- Sist oppdatert: **29. mai 2026**.
- 9 punkter basert på utkastet ditt, tilpasset karrierenmin:
  - **1. Behandlingsansvarlig:** Karrierenmin, St. Halvardsvei 2B, 1358 Jar. Kontakt: `hei@karrierenmin.no` (personvern) og `hvaage@gmail.com` (daglig ansvarlig).
  - **2. Opplysninger vi samler inn:** konto (e-post, navn, kryptert passord), profildata (CV, jobbønsker, kompetanse, erfaring, notater), innhold du lager (søknader, kontakter, vurderinger, oppfølgingsnotater), tekniske data (IP, nettleser, enhet, cookies), integrasjoner (LinkedIn, jobbportaler du kobler til).
  - **3. Formål og rettslig grunnlag:** avtale (art. 6(1)(b)), berettiget interesse (art. 6(1)(f)) for produktutvikling og sikkerhet, samtykke (art. 6(1)(a)) for markedsføring.
  - **4. Deling:** ingen salg; databehandlere for hosting (Lovable Cloud i EU), AI-modeller for søknads- og selskapsanalyse (Anthropic Claude), jobbportal-integrasjoner (Careerjet, LinkedIn) — alt under databehandleravtaler. SCC ved overføring utenfor EØS.
  - **5. Lagringstid:** så lenge du har konto; sletting via konto-innstillinger eller e-post; lovpålagt lagring der det kreves.
  - **6. Dine rettigheter:** innsyn, retting, sletting, dataportabilitet, protest, tilbaketrekking av samtykke, klage til Datatilsynet.
  - **7. Cookies:** nødvendige for innlogging, valgfrie analytics; samtykke kan trekkes tilbake via nettleserens lagring.
  - **8. Sikkerhet:** TLS i transport, kryptert lagring, tilgangsstyring, minste privilegium, varsling ved brudd.
  - **9. Endringer:** kan oppdateres; vesentlige endringer varsles per e-post eller i tjenesten.
- Setningen om brukervilkår/EULA droppes inntil en slik side finnes.

## Det jeg IKKE gjør

- Ingen ny rute, ingen redirect, ingen URL-endring (Footer-lenken til `/personvern` finnes allerede).
- Ingen DB-migrasjoner, edge functions eller secrets.
