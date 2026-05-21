# Supported report languages

The skill renders the final PDF in exactly one of the twelve languages below. The user selects the language during interactive intake. The renderer enforces this list via `scripts/i18n.py`.

| ISO 639-1 | Native name | English name | Primary in-scope countries |
|---|---|---|---|
| nb | Norsk bokmål | Norwegian Bokmål | Norway |
| sv | Svenska | Swedish | Sweden, parts of Finland |
| da | Dansk | Danish | Denmark |
| fi | Suomi | Finnish | Finland |
| is | Íslenska | Icelandic | Iceland |
| de | Deutsch | German | Germany, Austria, Switzerland, Luxembourg |
| nl | Nederlands | Dutch | Netherlands, Belgium |
| fr | Français | French | France, Belgium, Switzerland, Luxembourg |
| en | English | English | United Kingdom, Ireland, default fallback |
| es | Español | Spanish | Spain |
| pt | Português | Portuguese | Portugal |
| it | Italiano | Italian | Italy, Switzerland |

## Defaults and overrides

There is no automatic language detection. The user always selects the language explicitly during intake. The skill never assumes a language from the country code, the browser, or the operating system locale.

## Adding a language

To add a new language:

1. Add the ISO 639-1 code and native name to the table above.
2. Add a complete language pack to `LANGUAGE_PACKS` in `scripts/i18n.py`. Every key in the English pack must be present.
3. Re-run the renderer with a sample data file and the new language code to verify all strings render correctly.
4. Update the language list in `SKILL.md` block 2 of the interactive intake.
