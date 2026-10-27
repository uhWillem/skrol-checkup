---
name: webflow-checkup
description: Voert de pre-launch check-up van een Webflow-site uit met de Skrol-browsertool en schrijft een bugrapport. Gebruik bij "run check-up op [site]", een QA vóór de lancering, of een vraag om een Webflow-site op bugs te testen.
---

# Webflow check-up

Je voert de check-up uit met de tools van de Skrol-browsertool (`start_checkup`, `get_checkup_status`, `get_findings`, `list_pages`, `get_screenshot`) en schrijft daarna een bugrapport voor het team van Skrol. Het team beslist wat er gefixt wordt.

## Werkwijze

1. **URL bepalen.** Gebruik de staging-URL op `.webflow.io` die de gebruiker geeft. Geen URL gekregen? Vraag ernaar. Een live klantdomein werkt enkel als het in de toegestane domeinen van de server staat.
2. **Starten.** Roep `start_checkup` aan en zeg in één zin dat de check-up loopt. Ken je het live domein van de klant (de gebruiker noemt het, of het blijkt uit de vraag), geef het mee als `live_domain`, bv. `klant.be`. Vraag er niet apart naar: zonder `live_domain` haalt de tool het uit de sitemap als dat kan. Met een live domein vergelijkt de tool ook de oude site die daar nu draait (redirects, slugs, SEO-titels); de cijfers staan in `summary.migration`.
3. **Opvolgen.** Vraag `get_checkup_status` op tot de status `done` of `failed` is. Een check-up duurt meestal enkele minuten. Bij `failed`: meld de foutmelding letterlijk en stop.
4. **Bevindingen ophalen.** Haal ze op per prioriteit: eerst `hint: "hoog"`, dan `"midden"`, dan `"laag"`. Volg `next_offset` tot alles binnen is.
5. **Lay-out nakijken.** Bevindingen van `overlap`, `clipped-text`, `text-outside` en `image-text-order` hebben "na te kijken": de tool meet ze, maar weet niet of het er fout uitziet. Bekijk ze met `get_screenshot` (url = start-URL + pagina, `width` = `viewport` van de bevinding, `selector` = `element`). Zie je de fout op het screenshot, dan is het een zekere bug met als bewijs "screenshot op N px". Zie je ze niet, laat ze dan weg. Zijn er veel van dezelfde soort, bekijk er dan een paar en zeg in het rapport hoeveel je bekeken hebt.
6. **Pagina's bekijken.** Dit is het checklist-punt "Check on All Devices and Small Laptops". Haal `list_pages` op en bekijk de homepage en één pagina per sectie op 1440, 992 en 390 px; vraag de volgende delen op (`part`) als de pagina langer is. Kijk naar wat de metingen niet zien: elementen die verspringen of verdwijnen, witruimte die niet klopt, afbeeldingen die verkeerd uitgesneden zijn, een menu of footer die niet past. Meld enkel duidelijke fouten, met "screenshot op N px" als bewijs. Houd het bij een twintigtal screenshots. Sla je deze stap over, zet het punt dan op de afvinklijst.
7. **Rapport schrijven** volgens [references/rapport.md](references/rapport.md).
8. **Fixes** enkel als het team erom vraagt, bv. "fix I3, R1 en L2". Zie "Fixes" hieronder.

## Regels voor het rapport

- Elke bug in het rapport komt uit een bevinding van de tool, of uit een screenshot die je zelf bekeek met `get_screenshot`. Verzin geen bugs en vul niets aan uit eigen veronderstellingen.
- Het rapport is ingedeeld per soort fout (Inhoud, Responsive, Links, Formulieren, SEO, Navigatie en logo, Afbeeldingen en stijl, CMS, Projectinstellingen), met een code per bug (I1, R2, …), met de prioriteit als bolletje: 🔴 hoog, 🟠 midden, 🟡 laag.
- Neem de prioriteit van de tool over (`hint`). Wijk enkel af als het bewijs duidelijk anders zegt, en zeg dan waarom. De regels staan in [references/prioriteiten.md](references/prioriteiten.md).
- Bevindingen met `label: "na te kijken"` krijgen het witte bolletje ⚪ en staan onderaan hun soort. Presenteer ze nooit als zekere bug, behalve lay-outbevindingen die je op een screenshot bevestigd hebt (stap 5).
- Een bevinding met meerdere pagina's is één bug. Noem de eerste pagina's en het totaal (`pageCount`).
- Gebruik `evidence` om de bug concreet te maken: welk element, welke waarde, welke link.
- Staat er geen `liveDomain` in de samenvatting, zeg dan bovenaan het rapport dat links naar het live domein als externe links geteld zijn.
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
