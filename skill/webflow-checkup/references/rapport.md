# Rapportformaat

Gebruik exact deze opbouw. Laat een sectie weg als ze leeg is, behalve "Niet automatisch gecontroleerd".

```markdown
# Check-up {site} — {datum}

{aantal} pagina's gecontroleerd, {aantal} bevindingen: {n} hoog, {n} midden, {n} laag.
{Eén zin met de belangrijkste conclusie, bv. "Twee kapotte interne links en horizontale scroll op mobiel moeten vóór de lancering opgelost worden."}

## Hoog

| # | Pagina | Bug | Bewijs | Voorstel | Claude kan fixen |
| --- | --- | --- | --- | --- | --- |
| 1 | /diensten (+3) | Pagina scrolt horizontaal op 390 en 360 px | `.hero_image-wrapper` is 452 px breed | max-width 100% op de wrapper | Nee |

## Midden

(zelfde tabel)

## Laag

(zelfde tabel)

## Na te kijken

Bevindingen die de tool niet zeker kon vaststellen. Het team bevestigt ze of schrapt ze.

| # | Pagina | Wat | Waarom onzeker |
| --- | --- | --- | --- |

## Niet automatisch gecontroleerd

- [ ] {checklist-punt} ({categorie})
```

## Afspraken

- Nummer de bugs doorlopend over alle secties, zodat het team kan zeggen "fix 1, 4 en 7".
- Pagina: het pad van de eerste pagina, en `(+n)` als de bug op meer pagina's staat.
- Bewijs: één korte regel uit `evidence` of `element`, of "screenshot op 390 px" als je de fout op een screenshot zag. Geen volledige JSON.
- Voorstel: wat het team in Webflow moet aanpassen, in één zin.
- Claude kan fixen: "Ja" enkel voor de soorten fixes uit SKILL.md, anders "Nee".
- Stopte de check-up aan het vangnet (`stoppedAtMaxPages`), zeg dat bovenaan het rapport.
