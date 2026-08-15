
## Markedsdekkende utvalgsstatistikk (mangler)

Utvalgsinnsikt-panelet på `/arbeidsgivere` er fjernet. Det beskrev bare radene på
gjeldende side (typisk 13 av flere hundre treff), valgt av rangeringen og ikke av
representativitet, og motsa ansattebanneret som er markedsdekkende.

For å gi ekte statistikk over et helt søkeresultat trengs en summary-RPC på linje med
`public.employer_ansatte_distribution`: samme filterparametre som `search_employers`,
men aggregater (bransjefordeling, geografi, risikoflagg, økonomiske medianer) beregnet
over hele treffmengden med eksplisitt merking når den beregnes over et utvalg. Den
finnes ikke i dag. Risikoflagg er i mellomtiden eksponert som et rent tabellfilter
("vis kun selskaper med flagg"), som ikke påstår å være statistikk.
