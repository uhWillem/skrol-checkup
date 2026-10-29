---
name: webflow-checkup
description: Voert de pre-launch check-up van een Webflow-site uit met de Skrol-browsertool (connector Checkup) en schrijft een bugrapport als doc. Gebruik bij "run check-up op [site]", een QA vóór de lancering, of een vraag om een Webflow-site op bugs te testen.
---

# Webflow check-up

Je voert de check-up uit met de tools van de Skrol-browsertool (`start_checkup`, `get_checkup_status`, `get_findings`, `list_pages`, `get_screenshot`) en schrijft daarna een bugrapport voor het team van Skrol. Het team beslist wat er gefixt wordt.

Het resultaat is altijd een **doc** (Claude Docs), nooit enkel een antwoord in de chat: het team deelt het rapport, zet er opmerkingen bij en vinkt de afvinklijst af. In de chat zet je enkel een korte samenvatting (aantal bugs per prioriteit, de belangrijkste drie) en de link naar het doc.

## Werkwijze

1. **URL bepalen.** Gebruik de staging-URL op `.webflow.io` die de gebruiker geeft. Geen URL gekregen? Vraag ernaar. Een live klantdomein werkt enkel als het in de toegestane domeinen van de server staat.
2. **Starten.** Roep `start_checkup` aan en zeg in één zin dat de check-up loopt. Ken je het live domein van de klant (de gebruiker noemt het, of het blijkt uit de vraag), geef het mee als `live_domain`, bv. `klant.be`. Vraag er niet apart naar: zonder `live_domain` haalt de tool het uit de sitemap als dat kan. Met een live domein vergelijkt de tool ook de oude site die daar nu draait (redirects, slugs, SEO-titels); de cijfers staan in `summary.migration`. Heeft de server een Webflow-token voor de site, dan leest de tool ook het CMS, de paginanamen en de tijdzone uit Webflow (`summary.webflow`).
3. **Opvolgen.** Vraag `get_checkup_status` op tot de status `done` of `failed` is. Een check-up duurt meestal enkele minuten. Bij `failed`: meld de foutmelding letterlijk en stop.
4. **Bevindingen ophalen.** Haal ze op per prioriteit: eerst `hint: "hoog"`, dan `"midden"`, dan `"laag"`. Volg `next_offset` tot alles binnen is.
5. **Lay-out nakijken.** Bevindingen van `overlap`, `clipped-text`, `text-outside` en `image-text-order` hebben "na te kijken": de tool meet ze, maar weet niet of het er fout uitziet. Bekijk ze met `get_screenshot` (url = start-URL + pagina, `width` = `viewport` van de bevinding, `selector` = `element`). Zie je de fout op het screenshot, dan is het een zekere bug met als bewijs een link naar het screenshot (zie "Bewijs" onder "Afspraken"). Zie je ze niet, laat ze dan weg. Zijn er veel van dezelfde soort, bekijk er dan een paar en zeg in het rapport hoeveel je bekeken hebt.
6. **Pagina's bekijken.** Dit is het checklist-punt "Check on All Devices and Small Laptops". Haal `list_pages` op en bekijk de homepage en één pagina per sectie op 1440, 992 en 390 px; vraag de volgende delen op (`part`) als de pagina langer is. Kijk naar wat de metingen niet zien: elementen die verspringen of verdwijnen, witruimte die niet klopt, afbeeldingen die verkeerd uitgesneden zijn, een menu of footer die niet past. Meld enkel duidelijke fouten, met de link naar het screenshot als bewijs. Houd het bij een twintigtal screenshots. Sla je deze stap over, zet het punt dan op de afvinklijst.
7. **Rapport schrijven** als doc, volgens "Rapportformaat" hieronder. Maak het doc aan met de titel "Check-up {site} — {datum}" en één blok per soort, open het, en vul daarna soort per soort: de overzichtstabel, dan per soort de inleiding, de tabel en de detailtabellen. Een tabel in markdown kan geen opsomming in een cel bevatten: zet daarna de cellen met meerdere punten om naar een opsomming (de cel vervangen met een markdown-lijst), zet in elke cel van de kolom Opgelost een afvinkvakje (de cel vervangen met `- [ ] `) en geef als laatste om de andere rij de grijze kleur (zie "Afspraken"). Is er geen docs-tool in de chat, maak dan een artifact (een pagina) met dezelfde inhoud. Schrijf het rapport nooit enkel in de chat.
8. **Fixes** en andere aanpassingen in Webflow enkel als de gebruiker erom vraagt, bv. "fix I3, R1 en L2". Zie "Fixes" hieronder.

## Regels voor het rapport

- Elke bug in het rapport komt uit een bevinding van de tool, of uit een screenshot die je zelf bekeek met `get_screenshot`. Verzin geen bugs en vul niets aan uit eigen veronderstellingen.
- Het rapport is ingedeeld per soort fout (Inhoud, Responsive, Links, Formulieren, SEO, Navigatie en logo, Afbeeldingen en stijl, CMS, Projectinstellingen), met een code per bug (I1, R2, …), met de prioriteit als bolletje: 🔴 hoog, 🟠 midden, 🟡 laag.
- Neem de prioriteit van de tool over (`hint`). Wijk enkel af als het bewijs duidelijk anders zegt, en zeg dan waarom. Zie "Prioriteiten" hieronder.
- Bevindingen met `label: "na te kijken"` krijgen het witte bolletje ⚪ en staan onderaan hun soort. Presenteer ze nooit als zekere bug, behalve lay-outbevindingen die je op een screenshot bevestigd hebt (stap 5).
- Een bevinding met meerdere pagina's is één bug. Noem de eerste pagina's en het totaal (`pageCount`).
- Gebruik `evidence` om de bug concreet te maken: welk element, welke waarde, welke link.
- Staat er geen `liveDomain` in de samenvatting, zeg dan bovenaan het rapport dat links naar het live domein als externe links geteld zijn.
- Punten uit de checklist die niet in `coverage` staan, controleert de tool niet. Zet ze onderaan als afvinklijst (zie "Checklist" hieronder).
- Schrijf in het Nederlands, kort en concreet.

## Fixes

Fixes en andere aanpassingen lopen via de officiële Webflow-connector, nooit via de browsertool. Vraagt de gebruiker een aanpassing, dan mag je in principe alles wijzigen wat de connector kan: bv. teksten en elementen, CMS-items en -velden, pagina-instellingen (SEO-titels, descriptions, OG, slugs, schema), alt-teksten, links, headings, classes, stijlen en variabelen, componenten, formulieren, interacties, scripts en custom code.

- Voer enkel uit wat de gebruiker vraagt, bv. "fix I3, R1 en L2" of "vervang de lorem ipsum op /over door deze tekst". Breid de opdracht niet zelf uit; zie je onderweg nog iets, meld het dan.
- Is de vraag ruim ("fix alle SEO-titels") of raakt ze veel pagina's of items, zet dan eerst kort op een rij wat je gaat wijzigen en wacht op een ja.
- Inhoud die de klant moet aanleveren (echte teksten, foto's, een logo) verzin je niet: stel een tekst voor en wacht op een ja, of vraag de inhoud.
- Is een wijziging moeilijk terug te draaien (het type van een CMS-veld, de slug van een pagina die al live staat), zeg dat dan vóór je ze uitvoert.
- Zegt een tool dat de site in de Webflow Designer open moet staan, vraag de gebruiker dan om ze te openen en probeer daarna opnieuw.

Publiceren en verwijderen (pagina's, CMS-items, collecties, assets) doe je enkel als de gebruiker daar uitdrukkelijk om vraagt; "fix I3" is geen vraag om te publiceren. Zeg dan eerst precies wat er gepubliceerd of verwijderd wordt en wacht op een ja.

Publiceren mag enkel naar het staging-domein op `.webflow.io`. Naar het live domein (het eigen domein van de klant) publiceer je nooit, ook niet als de gebruiker erom vraagt: dat doet iemand van Skrol zelf in Webflow. Heeft de site een eigen domein, zet CMS-items dan ook niet rechtstreeks live (`publish_collection_items` of de live-varianten van de item-tools), want dan komen ze op het live domein.

Na de aanpassingen zeg je per bug wat je gewijzigd hebt, wat nog gepubliceerd moet worden voor het op de site staat, en dat iemand van Skrol het resultaat nakijkt en naar het live domein publiceert.

Is de Webflow-connector niet beschikbaar in de chat, dan geef je per bug het voorstel tot oplossing, voer je niets uit en zeg je dat de connector nodig is.

## Rapportformaat

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

| # | Opgelost | Prio | Pagina | Bug | Bewijs | Voorstel | Claude kan fixen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | ☐ | 🔴 | [/diensten](https://klant.webflow.io/diensten) (+3) | Lorem ipsum in de intro | `.hero_text` p: "Lorem ipsum dolor…" | Echte tekst plaatsen | Nee |
| I2 | ☐ | 🔴 | [/voorwaarden](https://klant.webflow.io/voorwaarden) | De pagina is leeg | [Screenshot op 1440 px](https://checkup.skrol.agency/screenshots/…): geen navigatie, geen tekst | Pagina opbouwen met navigatie, footer en tekst | Nee |
| I3 | ☐ | ⚪ | [/blog](https://klant.webflow.io/blog) (+4) | Afbeelding met "placeholder" in de bestandsnaam | 6adb…_placeholder.svg | Nakijken: echte afbeelding of bewust gekozen? | Nee |

## Responsive (R)

(zelfde tabel, met R1, R2, …)

### R2 · Secties met de tekst boven de afbeelding op gsm

| Sectie | Pagina's |
| --- | --- |
| "Onze diensten" (.services_component) | [/](https://klant.webflow.io/), [/over](https://klant.webflow.io/over) |

## Niet automatisch gecontroleerd

- [ ] {checklist-punt} ({categorie})
```

### Soorten

Elke bevinding gaat naar de soort van haar controle (`check`):

| Soort | Code | Controles |
| --- | --- | --- |
| Inhoud | I | `missing-content`, `test-page`, `draft-pages` |
| Responsive | R | `horizontal-scroll`, `overlap`, `clipped-text`, `text-outside`, `image-text-order`, en wat je zelf op screenshots ziet |
| Links | L | `broken-links`, `empty-links` |
| Formulieren | F | `form-success-message`, `form-error-message`, `form-name`, `form-inputs` |
| SEO | S | `heading-1`, `heading-structure`, `image-alt`, `seo-title`, `seo-description`, `seo-migration`, `redirects`, `slugs`, `schema`, `page-structure`, `indexing`, `noindex`, `sitemap`, `default-domain` |
| Navigatie en logo | N | `nav-sticky`, `nav-scroll-lock`, `nav-menu-fit`, `logo-link`, `logo-format` |
| Afbeeldingen en stijl | A | `image-quality`, `hover-state`, `fonts`, `heading-style`, `input-style` |
| CMS | C | `empty-state`, `cms-seo`, `cms-slugs`, `cms-fields`, `cms-items`, `cms-content`, `conditional-visibility` |
| Projectinstellingen | P | `webflow-badge`, `favicon`, `lang`, `gtm`, `timezone`, `page-names` |

Een nieuwe controle die hier niet staat, zet je bij de soort die er het best bij past.

### Afspraken

- Volgorde van de soorten: zoals in de tabel hierboven. Binnen een soort: eerst 🔴, dan 🟠, dan 🟡, en ⚪ onderaan.
- Elke bug krijgt de code van haar soort en een volgnummer binnen die soort (I1, I2, R1, …), zodat het team kan zeggen "fix I3, R1 en L2". Een bug die later bijkomt krijgt het volgende nummer van haar soort; de andere codes blijven gelijk.
- Opgelost: de tweede kolom van elke bugtabel is een afvinkvakje (☐ in het voorbeeld hierboven), zodat het team opgeloste bugs kan afvinken. Detailtabellen krijgen geen vakje. Het team vinkt zelf af; Claude vinkt niets aan, ook niet na een fix, want iemand van Skrol kijkt de fix eerst na.
- Prio: het bolletje van de `hint` van de tool. Een bevinding met `label: "na te kijken"` krijgt ⚪, tenzij je ze op een screenshot bevestigd hebt; dan krijgt ze het bolletje van haar `hint`.
- Pagina: het pad van de eerste pagina als link naar die pagina op de gecontroleerde site (start-URL + pad), en `(+n)` als de bug op meer pagina's staat.
- Links: elk pad van een pagina in het rapport is een link, ook in Bewijs en in de lijsten onder de tabellen. Kapotte externe links, pdf's en links die bots weren zijn ook klikbaar, zodat het team ze meteen kan testen. Oude paden van het live domein (die niet meer bestaan) blijven gewone tekst.
- Bewijs: één korte regel uit `evidence` of `element`, of een link naar het screenshot als je de fout op een screenshot zag. Het antwoord van `get_screenshot` bevat `screenshotUrl`, een vaste link die het beeld in een apart tabblad opent: schrijf `[Screenshot op 390 px](screenshotUrl)`, en bij twee breedtes "Screenshot op [1440 px](…) en [390 px](…)". Neem per bug het screenshot met de `selector` van het element, zodat het omkaderd is. Zet screenshots nooit als afbeelding in het doc. Geeft het antwoord geen `screenshotUrl`, schrijf dan gewoon "screenshot op 390 px". Geen volledige JSON.
- Opsommingen: staan er in een cel meerdere punten (meerdere elementen, pagina's, opmerkingen of stappen), zet ze dan als opsomming in de cel, één punt per regel. Een toelichting bij een punt, of de pagina's die bij een punt horen, komen als ingesprongen subpunten. Eén zin met één punt blijft gewone tekst. Een lange reeks namen of oude paden (meer dan tien) blijft tekst met komma's.
- Rijkleuren: in elke tabel, ook de overzichtstabel en de detailtabellen, krijgt om de andere rij (de 2e, 4e, … rij onder de kop) de grijze celkleur #f0efec, zodat je bij horizontaal scrollen de rij blijft volgen. Kleur de rijen pas als de tabel af is; komt er later een rij bij, kleur de tabel dan opnieuw.
- Voorstel: wat het team in Webflow moet aanpassen, in één zin. Bij ⚪: wat het team moet nakijken en waarom het onzeker is.
- Claude kan fixen: "Ja" als de fix een aanpassing in Webflow is die Claude via de Webflow-connector kan doen (zie "Fixes"). "Nee" als ze iets buiten Webflow vraagt (DNS, Search Console, een CRM, de oude site) of inhoud die de klant moet aanleveren (echte teksten, een scherpere foto).
- Details die niet in één cel passen (alle kapotte links, alle secties, oude paden) komen direct onder de tabel van hun soort: per bug een kop `### L1 · korte titel` en daaronder een kleine tabel met één rij per link, sectie of pagina. Onder de kop mag hoogstens één korte alinea uitleg staan. Geen losse notities of opsommingen onder de tabellen, en dezelfde gegevens nooit in twee detailtabellen.
- Een bug die na controle geschrapt is, vermeld je in één zin in de inleiding van haar soort.
- Stopte de check-up aan het vangnet (`stoppedAtMaxPages`), zeg dat bovenaan het rapport.
- Webflow-lezer: staat er `webflow` in de samenvatting, noem dan in de inleiding van CMS welke site gelezen is en hoeveel collecties en items. Staan de Webflow-controles in `skipped`, zet de reden dan bij die punten op de afvinklijst (bv. "geen Webflow-token voor deze site").
- Migratie: staat er `migration` in de samenvatting, zet dan bovenaan de SEO-soort één zin met de cijfers, bv. "Van de 120 pagina's van de oude site (www.klant.be) bestaan er 80 op hetzelfde pad, 25 hebben een redirect en 15 geven een 404." Met `truncated: true` zeg je dat enkel de eerste 300 pagina's vergeleken zijn. Staan de migratiecontroles in `skipped`, zet de reden dan bij Redirects, Page and CMS Slugs en When Migrating op de afvinklijst.
- Bij `redirects` en `slugs` zijn de pagina's oude paden: zet ze als gewone tekst. De volledige lijst (uit `evidence`) komt in de detailtabel van de bug, gegroepeerd per sectie van de oude site (kolommen Groep, Aantal, Oude paden). Bij `slugs` toon je per pad waar de redirect naartoe gaat (kolommen Oud pad, Redirect naar).
- Bij `seo-migration` toon je in de detailtabel per pagina de oude en de nieuwe titel (of description), de eerste tien en het totaal.

## Prioriteiten

- **Hoog**: een bezoeker ziet het, of de vindbaarheid lijdt eronder. Bijvoorbeeld een kapotte interne link, horizontale scroll, geen of twee h1's, lorem ipsum of standaardtekst van Webflow, een standaardmelding bij formulieren, de Webflow-badge, of een staging-domein dat geïndexeerd wordt.
- **Midden**: het werkt, maar het is niet af. Bijvoorbeeld een kapotte externe link, ontbrekende alt-teksten, een formulier zonder eigen naam, velden met een standaardnaam, een ontbrekend of standaard favicon, of een ontbrekende taalcode.
- **Laag**: interne afspraken die de bezoeker niet ziet, of kleine onvolkomenheden. Bijvoorbeeld een overgeslagen headingniveau, een ontbrekende web clip, classnamen in Title Case of helpteksten bij CMS-velden.

Twijfel je tussen twee niveaus, kies het hoogste en zeg waarom.

## Checklist

De 74 punten van de pre-launch checklist van Skrol. Punten die niet in `coverage` van get_checkup_status staan, controleert de tool niet: zet ze in het rapport als afvinklijst, met de categorie tussen haakjes.

- **Style Guide**: Global Heading Tags; Rich Text; Global Colors; Global Buttons; Custom Inputs and Form Fields; Custom Container and Grid Set Up; Global Margin & Padding Classes; Max Width Classes; Navigation and Footer Symbols; Fonts
- **Usability and Design**: Hover States; Linking Pages; Interaction Speed; Interactions on Tabs, Dropdowns and Sliders; Navigation; Tablet and Mobile Hover States; Double Check Spacings; Missing Content; Blurry Images; Images Height; Navigation Scroll; Nav Menu Scroll; Image + Text; Horizontal Scroll; Check on All Devices and Small Laptops
- **SEO**: Heading 1; Heading Structure; When Migrating - SEO Title & Description; When It's a New Site - SEO Title & Description; Image Alt Texts; Page Structure; Schema Markup; Webflow Domain Indexing; Website Sitemap; Default Domain; Search Console; Page and CMS Slugs; Redirects; Speed
- **Forms**: Input Settings; Form Settings; Form Success Message; Form Error Message; CRM Connection; Custom Validation
- **CMS Pages**: CMS Slugs; CMS Fields; Dummy CMS Content; CMS Connection; Conditional Visibility; CMS Post Pages Designs; Empty CMS List State; CMS Items connections; Dynamic SEO Titles, Descriptions and OG Images; CMS Sorting & Filtering; CMS Switches
- **Symbols**: Symbol Check; New Page in Flow Starter
- **Naming Conventions**: All Classes in Title Case; Page Names in Title Case; Interaction Naming
- **Logo**: Logo Link; Logo Alt Text; Logo Size
- **Project Settings**: Favicon and Web Clip; Language Code; Remove Webflow Branding; Timezone; Advanced Publishing Options; Custom Client Branding
- **Tracking**: GTM Set Up
- **Final Check**: Google Chrome; Safari; Firefox
