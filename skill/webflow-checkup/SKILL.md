---
name: webflow-checkup
description: Voert de pre-launch check-up van een Webflow-site uit met de Skrol-browsertool en schrijft een bugrapport. Gebruik bij "run check-up op [site]", een QA vóór de lancering, of een vraag om een Webflow-site op bugs te testen.
---

# Webflow check-up

Je voert de check-up uit met de tools van de Skrol-browsertool (`start_checkup`, `get_checkup_status`, `get_findings`) en schrijft daarna een bugrapport voor het team van Skrol. Het team beslist wat er gefixt wordt.

## Werkwijze

1. **URL bepalen.** Gebruik de staging-URL op `.webflow.io` die de gebruiker geeft. Geen URL gekregen? Vraag ernaar. Een live klantdomein werkt enkel als het in de toegestane domeinen van de server staat.
2. **Starten.** Roep `start_checkup` aan en zeg in één zin dat de check-up loopt.
3. **Opvolgen.** Vraag `get_checkup_status` op tot de status `done` of `failed` is. Een check-up duurt meestal enkele minuten. Bij `failed`: meld de foutmelding letterlijk en stop.
4. **Bevindingen ophalen.** Haal ze op per prioriteit: eerst `hint: "hoog"`, dan `"midden"`, dan `"laag"`. Volg `next_offset` tot alles binnen is.
5. **Rapport schrijven** volgens [references/rapport.md](references/rapport.md).
6. **Fixes** enkel als het team erom vraagt, bv. "fix 1, 4 en 7". Zie "Fixes" hieronder.

## Regels voor het rapport

- Elke bug in het rapport komt uit een bevinding van de tool. Verzin geen bugs en vul niets aan uit eigen veronderstellingen.
- Neem de prioriteit van de tool over (`hint`). Wijk enkel af als het bewijs duidelijk anders zegt, en zeg dan waarom. De regels staan in [references/prioriteiten.md](references/prioriteiten.md).
- Bevindingen met `label: "na te kijken"` blijven in een aparte sectie. Presenteer ze nooit als zekere bug.
- Een bevinding met meerdere pagina's is één bug. Noem de eerste pagina's en het totaal (`pageCount`).
- Gebruik `evidence` om de bug concreet te maken: welk element, welke waarde, welke link.
- Punten uit de checklist die niet in `coverage` staan, controleert de tool niet. Zet ze onderaan als afvinklijst ([references/checklist.md](references/checklist.md)).
- Schrijf in het Nederlands, kort en concreet.

## Fixes

Fixes lopen via de officiële Webflow-connector, nooit via de browsertool. Claude mag enkel deze soorten fixes uitvoeren, één wijziging per goedkeuring:

- SEO-titels, descriptions en OG-velden, en JSON-LD-schema per pagina.
- Alt-teksten van afbeeldingen.
- Placeholdertekst in CMS-items en helpteksten bij CMS-velden.
- Kapotte links, en target en rel op externe links.
- Heading-niveaus.
- Namen van classes en kleurvariabelen.

Nooit: de site of CMS-items publiceren (ook niet `publish_collection_items`), iets verwijderen, stijlen of lay-out aanpassen, of scripts wijzigen. Na de fixes zeg je welke bugs aangepakt zijn en dat iemand van Skrol het resultaat nakijkt en publiceert.

Is de Webflow-connector niet beschikbaar, dan geef je per bug het voorstel tot oplossing en voer je niets uit.
