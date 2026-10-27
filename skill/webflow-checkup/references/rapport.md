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
| I1 | 🔴 | [/diensten](https://klant.webflow.io/diensten) (+3) | Lorem ipsum in de intro | `.hero_text` p: "Lorem ipsum dolor…" | Echte tekst plaatsen | Nee |
| I2 | ⚪ | [/blog](https://klant.webflow.io/blog) (+4) | Afbeelding met "placeholder" in de bestandsnaam | 6adb…_placeholder.svg | Nakijken: echte afbeelding of bewust gekozen? | Nee |

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
| SEO | S | `heading-1`, `heading-structure`, `image-alt`, `seo-title`, `seo-description`, `seo-migration`, `redirects`, `slugs`, `schema`, `page-structure`, `indexing`, `noindex`, `sitemap`, `default-domain` |
| Navigatie en logo | N | `nav-sticky`, `nav-scroll-lock`, `nav-menu-fit`, `logo-link`, `logo-format` |
| Afbeeldingen en stijl | A | `image-quality`, `hover-state`, `fonts`, `heading-style`, `input-style` |
| CMS | C | `empty-state`, `cms-seo`, `cms-slugs` |
| Projectinstellingen | P | `webflow-badge`, `favicon`, `lang`, `gtm` |

Een nieuwe controle die hier niet staat, zet je bij de soort die er het best bij past.

## Afspraken

- Volgorde van de soorten: zoals in de tabel hierboven. Binnen een soort: eerst 🔴, dan 🟠, dan 🟡, en ⚪ onderaan.
- Elke bug krijgt de code van haar soort en een volgnummer binnen die soort (I1, I2, R1, …), zodat het team kan zeggen "fix I3, R1 en L2". Een bug die later bijkomt krijgt het volgende nummer van haar soort; de andere codes blijven gelijk.
- Prio: het bolletje van de `hint` van de tool. Een bevinding met `label: "na te kijken"` krijgt ⚪, tenzij je ze op een screenshot bevestigd hebt; dan krijgt ze het bolletje van haar `hint`.
- Pagina: het pad van de eerste pagina als link naar die pagina op de gecontroleerde site (start-URL + pad), en `(+n)` als de bug op meer pagina's staat.
- Links: elk pad van een pagina in het rapport is een link, ook in Bewijs en in de lijsten onder de tabellen. Kapotte externe links, pdf's en links die bots weren zijn ook klikbaar, zodat het team ze meteen kan testen. Oude paden van het live domein (die niet meer bestaan) blijven gewone tekst.
- Bewijs: één korte regel uit `evidence` of `element`, of "screenshot op 390 px" als je de fout op een screenshot zag. Geen volledige JSON.
- Voorstel: wat het team in Webflow moet aanpassen, in één zin. Bij ⚪: wat het team moet nakijken en waarom het onzeker is.
- Claude kan fixen: "Ja" enkel voor de soorten fixes uit SKILL.md, anders "Nee".
- Lange lijsten (bv. alle kapotte links) komen in een opsomming onder de tabel van hun soort, met het nummer van de bug erbij.
- Stopte de check-up aan het vangnet (`stoppedAtMaxPages`), zeg dat bovenaan het rapport.
- Migratie: staat er `migration` in de samenvatting, zet dan bovenaan de SEO-soort één zin met de cijfers, bv. "Van de 120 pagina's van de oude site (www.klant.be) bestaan er 80 op hetzelfde pad, 25 hebben een redirect en 15 geven een 404." Met `truncated: true` zeg je dat enkel de eerste 300 pagina's vergeleken zijn. Staan de migratiecontroles in `skipped`, zet de reden dan bij Redirects, Page and CMS Slugs en When Migrating op de afvinklijst.
- Bij `redirects` en `slugs` zijn de pagina's oude paden: zet ze als gewone tekst, en de volledige lijst (uit `evidence`) als opsomming onder de tabel. Bij `slugs` toon je per pad waar de redirect naartoe gaat.
- Bij `seo-migration` toon je onder de tabel per pagina de oude en de nieuwe titel (of description), de eerste tien en het totaal.
