# Innstillinger: glemt passord (E1) og fullstendig datasletting (E2)

E3 (Gmail/Outlook-tilkobling) er ikke med her — den venter på at OAuth-appene er registrert hos Google og Microsoft.

## Verifisert utgangspunkt

- Ingen bruk av `resetPasswordForEmail`, ingen `/glemt-passord`-rute, ingen lenke på innloggingssiden. En bruker som glemmer passordet kommer ikke inn igjen.
- `auth.callback.tsx` håndterer allerede både `?code=` og hash-tokens og setter sesjonen på den delte klienten (`storageKey: karrierenmin-auth`, `detectSessionInUrl: false`), så gjenoppretting må gå via samme mønster — den nye siden kan ikke stole på automatisk sesjonsdeteksjon.
- «Slett all min data» i `account-section.tsx` sletter fra 11 hardkodede tabeller. «Slett konto permanent» er ikke berørt (cascade fra `auth.users`).

## E1 — Glemt passord

1. **Lenke på innloggingssiden**: «Glemt passord?» under passordfeltet i `src/routes/login.tsx`.
2. **Ny rute `/glemt-passord`** (offentlig): e-postfelt → `supabase.auth.resetPasswordForEmail(epost, { redirectTo: ${origin}/auth/nytt-passord })`. Vis alltid samme nøytrale bekreftelse («Hvis adressen finnes hos oss, har vi sendt en lenke») så siden ikke avslører hvilke e-poster som er registrert.
3. **Ny rute `/auth/nytt-passord`** (offentlig): leser recovery-tokens fra hash (samme parsing som `auth.callback.tsx`), kaller `supabase.auth.setSession(...)`, rydder hashen, og viser skjema for nytt passord + bekreftelse. Ved lagring: `supabase.auth.updateUser({ password })`, deretter redirect til `/auth/callback` slik at eksisterende «hvor skal brukeren lande»-logikk gjenbrukes.
4. **Feilhåndtering**: samme mønster som `changePassword` i `account-section.tsx` — minst 8 tegn, passordene må være like, `toast.success`/`toast.error`. Ugyldig eller utløpt lenke gir tydelig melding med lenke tilbake til `/glemt-passord`.
5. Begge nye ruter får egen `head()` med tittel/beskrivelse og `robots: noindex`.

## E2 — «Slett all min data» dekker hele skjemaet

Listen skal ikke hardkodes fra en instruks. Den bygges fra skjemaet slik det faktisk er:

1. **Databasefunksjon** `public.delete_all_my_data()` (SECURITY DEFINER, `search_path = public`), som sletter for `auth.uid()`. Ingen parameter for bruker-ID — funksjonen kan bare slette den innloggende brukerens data.
2. Funksjonen itererer dynamisk over alle tabeller i `public` som har en `user_id`-kolonne med fremmednøkkel til `auth.users(id)`, og kjører `DELETE ... WHERE user_id = auth.uid()` per tabell i en transaksjon. Da holder listen seg riktig når skjemaet endres. Tabeller uten direkte `user_id` ryddes av eksisterende cascades fra foreldretabellene.
3. Før migrasjonen skrives, kjøres spørringen mot skjemaet og resultatet gjennomgås — tabeller som ikke skal tømmes (f.eks. globale registerdata eller revisjonsspor som må bestå) unntas eksplisitt med en navngitt unntaksliste i funksjonen.
4. `GRANT EXECUTE ON FUNCTION public.delete_all_my_data() TO authenticated;`
5. **Klientside**: `deleteMyData()` i `account-section.tsx` erstattes med ett `supabase.rpc("delete_all_my_data")`-kall + eksisterende opprydding av `cv-uploads`-filer i storage. Bekreftelsesdialogen beholdes, men teksten oppdateres til å si at all innhold slettes og bare kontoen beholdes.
6. `deleteAccount()` fortsetter å kalle datasletting først og deretter `delete-account`-funksjonen — uendret flyt, ny implementasjon under.

## Teknisk

- Ingen endringer i LinkedIn-integrasjonen eller i `delete-account`-edgefunksjonen.
- Migrasjonen inneholder kun funksjon + grant; ingen nye tabeller, ingen RLS-endringer.
- Etter bygging verifiseres: rad-tellinger per brukertabell før/etter sletting for en testbruker, og at recovery-lenken faktisk logger inn og setter nytt passord.
