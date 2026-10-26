# Rapportformaat

Het rapport is ingedeeld per soort fout. Binnen elke soort staat de prioriteit als gekleurd bolletje:

- 🔴 hoog
- 🟠 midden
- 🟡 laag
- ⚪ na te kijken: de tool kon het niet zeker vaststellen, het team bevestigt of schrapt

Gebruik exact deze opbouw. Laat een soort weg als ze leeg is, maar houd "Niet automatisch gecontroleerd" altijd.

```markdown
# Check-up {site} — {datum}

{aantal} pagina's gecontroleerd, {aantal} bevindingen van de tool. Gebundeld tot {n} bugs: {n} 🔴 hoog, {n} 🟠 midden, {n} 🟡 laag, en {n} ⚪ om na te kijken.
{Eén zin met de belangrijkste conclusie, bv. "Twee kapotte interne links en horizontale scroll op mobiel moeten vóór de lancering opgelost worden."}

| Soort | 🔴 | 🟠 | 🟡 | ⚪ |
| --- | --- | --- | --- | --- |
| Inhoud (I) | 2 | 0 | 0 | 1 |
| Responsive (R) | 1 | 1 | 0 | 2 |

## Inhoud (I)

| # | Prio | Pagina | Bug | Bewijs | Voorstel | Claude kan fixen |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | 🔴 | /diensten (+3) | Lorem ipsum in de intro | `.hero_text` p: "Lorem ipsum dolor…" | Echte tekst plaatsen | Nee |
| I2 | ⚪ | /blog (+4) | Afbeelding met "placeholder" in de bestandsnaam | 6adb…_placeholder.svg | Nakijken: echte afbeelding of bewust gekozen? | Nee |

## Responsive (R)

(zelfde tabel, met R1, R2, …)

## Niet automatisch gecontroleerd

- [ ] {checklist-punt} ({categorie})
```

## Soorten

Elke bevinding gaat naar de soort van haar controle (`check`):

| Soort | Code | Controles |
| --- | --- | --- |
| Inhoud | I | `missing-content`, `test-page` |
| Responsive | R | `horizontal-scroll`, `overlap`, `clipped-text`, `text-outside`, `image-text-order`, en wat je zelf op screenshots ziet |
| Links | L | `broken-links`, `empty-links` |
| Formulieren | F | `form-success-message`, `form-error-message`, `form-name`, `form-inputs` |
| SEO | S | `heading-1`, `heading-structure`, `image-alt` |
| Afbeeldingen en stijl | A | `image-quality` |
| CMS | C | `empty-state` |
| Projectinstellingen | P | `webflow-badge`, `favicon`, `lang` |

Een nieuwe controle die hier niet staat, zet je bij de soort die er het best bij past.

## Afspraken

- Volgorde van de soorten: zoals in de tabel hierboven. Binnen een soort: eerst 🔴, dan 🟠, dan 🟡, en ⚪ onderaan.
- Elke bug krijgt de code van haar soort en een volgnummer binnen die soort (I1, I2, R1, …), zodat het team kan zeggen "fix I3, R1 en L2". Een bug die later bijkomt krijgt het volgende nummer van haar soort; de andere codes blijven gelijk.
- Prio: het bolletje van de `hint` van de tool. Een bevinding met `label: "na te kijken"` krijgt ⚪, tenzij je ze op een screenshot bevestigd hebt; dan krijgt ze het bolletje van haar `hint`.
- Pagina: het pad van de eerste pagina, en `(+n)` als de bug op meer pagina's staat.
- Bewijs: één korte regel uit `evidence` of `element`, of "screenshot op 390 px" als je de fout op een screenshot zag. Geen volledige JSON.
- Voorstel: wat het team in Webflow moet aanpassen, in één zin. Bij ⚪: wat het team moet nakijken en waarom het onzeker is.
- Claude kan fixen: "Ja" enkel voor de soorten fixes uit SKILL.md, anders "Nee".
- Lange lijsten (bv. alle kapotte links) komen in een opsomming onder de tabel van hun soort, met het nummer van de bug erbij.
- Stopte de check-up aan het vangnet (`stoppedAtMaxPages`), zeg dat bovenaan het rapport.
