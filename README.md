# skrol-checkup

MCP-server voor de Webflow check-up bot van Skrol. De server crawlt een site in een headless Chromium, voert vaste controles uit uit de pre-launch checklist, en geeft de bevindingen aan Claude. Er zit geen AI in de server: dezelfde site geeft elke keer dezelfde bevindingen. Claude beoordeelt en schrijft het rapport.

Zie het technisch plan voor de volledige architectuur. Dit is versie 0.7: bijgestuurd na de eerste echte check-up (in4care), met lay-outcontroles, screenshots met een vaste link, navigatie, hoverstijlen, fonts, standaardstijlen van Webflow, SEO, een vergelijking met de oude site bij een migratie, en de Webflow-lezer voor het CMS en de projectinstellingen.

## Tools

| Tool | Wat ze doet |
| --- | --- |
| `start_checkup` | Start een check-up voor een URL als achtergrondtaak en geeft een job-ID terug. Optioneel `live_domain` (bv. `klant.be`): zie "Live domein" hieronder. |
| `get_checkup_status` | Status en voortgang; als de job klaar is, een samenvatting en de lijst gecontroleerde checklist-punten. |
| `get_findings` | Bevindingen, gesorteerd op prioriteit, te filteren op controle, pagina of prioriteit, per 100. |
| `list_pages` | Alle gecontroleerde pagina's met statuscode, per sectie (bv. `/blog`). |
| `get_screenshot` | Screenshot van een pagina op een schermbreedte: de volledige pagina in delen, of het stuk rond een element (`selector`) met het element omkaderd. Zo kijkt Claude lay-outbevindingen na en beoordeelt het pagina's. Elk screenshot krijgt een vaste link (`screenshotUrl`, `/screenshots/<id>.jpg`) die zonder API-sleutel opent, zodat het rapport ernaar kan linken. De id is 24 willekeurige tekens; na `SCREENSHOT_DAYS` dagen (standaard 180) wordt het beeld opgeruimd. |

## Wat deze versie controleert

| Controle | Checklist-punt | Prioriteit |
| --- | --- | --- |
| `broken-links` | Linking Pages: interne links (hoog) en externe links (midden) met HTTP 4xx/5xx, time-out of onbestaand domein. Links naar het live domein worden op de nieuwe site gecontroleerd (hoog). Sites die bots weren (401, 403, 429, 999) krijgen "na te kijken". | hoog / midden |
| `empty-links` | Linking Pages: links met `href=""`, `"#"` of `javascript:`. Lightbox-, dropdown- en tablinks tellen niet mee. | midden |
| `heading-1` | Heading 1: geen of meer dan één h1. | hoog |
| `heading-structure` | Heading Structure: overgeslagen niveaus. | laag |
| `horizontal-scroll` | Horizontal Scroll: de pagina scrolt horizontaal op een van de viewports. Overloop die verborgen wordt door overflow op html of body: "na te kijken". | hoog |
| `image-alt` | Image Alt Texts: geen alt-attribuut, een bestandsnaam als alt, of een link met enkel een afbeelding zonder alt (de link heeft dan geen naam). Lege alt op andere zichtbare afbeeldingen: "na te kijken". Eén bevinding per soort afbeelding (bv. het logo in de navigatie), met alle pagina's. | midden / laag |
| `missing-content` | Missing Content: lorem ipsum en Latijnse dummytekst zoals Webflow die in CMS-items zet (ook zonder de woorden "lorem ipsum"), Webflow-standaardteksten, de placeholderafbeelding van Webflow. Geüploade afbeeldingen met "placeholder" of "dummy" in de bestandsnaam: "na te kijken". | hoog |
| `test-page` | Missing Content: pagina's met test, copy, kopie, dummy of untitled in het adres, bv. testitems uit het CMS of een vergeten kopie. Altijd "na te kijken". | midden |
| `form-success-message` | Form Success Message: standaardtekst van Webflow. | hoog |
| `form-error-message` | Form Error Message: standaardtekst van Webflow. | hoog |
| `form-name` | Form Settings: formulier heet "Email Form" of heeft geen naam. | midden |
| `form-inputs` | Input Settings: standaardnamen (Field, Field 2) en e-mail- of telefoonvelden met het verkeerde type. | midden |
| `empty-state` | Empty CMS List State: standaardtekst "No items found.". | midden |
| `favicon` | Favicon and Web Clip: ontbrekend of het Webflow-standaardicoon. | midden / laag |
| `webflow-badge` | Remove Webflow Branding: de badge staat op de pagina. Op een .webflow.io-domein "na te kijken": zonder betaald site plan toont Webflow de badge daar altijd. | hoog |
| `lang` | Language Code: geen of een ongeldig lang-attribuut. | midden |
| `overlap` | Check on All Devices: tekst die over andere tekst valt, per schermbreedte. "Na te kijken": Claude bevestigt met een screenshot. | hoog |
| `clipped-text` | Check on All Devices: tekst die deels wegvalt in een vak met overflow hidden. Bewust afkorten (puntjes, line clamp) en sliders of logobalken tellen niet. "Na te kijken". | hoog |
| `text-outside` | Check on All Devices: tekst die buiten een knop, tag of badge loopt. "Na te kijken". | midden |
| `image-quality` | Blurry Images: afbeeldingen die meer dan 1,25× vergroot worden (wazig) of uitgerekt zijn omdat object-fit ontbreekt. SVG's tellen niet. | midden |
| `image-text-order` | Image + Text: een beeld en een tekstblok die naast elkaar staan, en op gsm (tot 480 px) met de tekst boven het beeld. "Na te kijken". | midden |
| `nav-sticky` | Navigation: na 800 px scrollen staat de navigatie niet meer bovenaan en komt ze ook niet terug als je 200 px naar boven scrolt ("na te kijken"), of ze staat er zonder achtergrond. Een navigatie die verdwijnt bij naar beneden scrollen en terugkomt bij naar boven scrollen is in orde. Op de startpagina. | midden |
| `nav-scroll-lock` | Navigation Scroll: met het gsm-menu open scrolt de pagina erachter mee (390 × 800). | midden |
| `nav-menu-fit` | Nav Menu Scroll: op een gsm in liggende stand (740 × 360) vallen links van het menu onder het scherm en het menu scrolt niet. | hoog |
| `logo-link` | Logo Link: het logo in de navigatie of de footer linkt niet naar de homepage. | midden |
| `logo-format` | Logo Size: het logo is geen SVG. | laag |
| `hover-state` | Hover States: links in de navigatie en de footer, en knoppen, die er bij hover hetzelfde uitzien (ook ::before, ::after en wat erin zit). Eén test per soort link of knop. | laag |
| `fonts` | Fonts: fonts van Google Fonts (midden), fonts in TTF, OTF of EOT (laag), en een body met de standaardtekst van Webflow (Arial 14/20). | midden / laag |
| `heading-style` | Global Heading Tags: koppen zonder class met de standaardgrootte van Webflow (bv. h2 32/36 px). | midden |
| `input-style` | Custom Inputs and Form Fields: formuliervelden met de standaardstijl van Webflow. | midden |
| `seo-title` | When It's a New Site - SEO Title & Description: geen titel of een titel met "Copy of" (hoog), dezelfde titel op meerdere pagina's (midden), langer dan 60 tekens (laag), en korte titels zonder merknaam die nog de paginanaam van Webflow lijken ("na te kijken"). | hoog / midden / laag |
| `seo-description` | Idem voor de meta description: ontbrekend, dubbel, langer dan 160 tekens. | midden / laag |
| `cms-seo` | Dynamic SEO Titles, Descriptions and OG Images: alle items van een CMS-template met dezelfde titel of description (niet aan een veld gekoppeld), of zonder; geen OG-afbeelding, of overal dezelfde ("na te kijken"). | hoog / midden / laag |
| `schema` | Schema Markup: geen JSON-LD op de homepage (midden), ongeldige JSON-LD (hoog), een FAQ-blok zonder FAQPage-schema ("na te kijken"). | midden |
| `page-structure` | Page Structure: geen of meer dan één `<main>`, geen `<nav>`, geen `<footer>`. | laag |
| `indexing` | Webflow Domain Indexing: de robots.txt van het .webflow.io-domein houdt zoekmachines niet tegen. | midden |
| `noindex` | Website Sitemap: pagina's op noindex (Sitemap indexing uit). "Na te kijken". | midden |
| `sitemap` | Website Sitemap: geen sitemap.xml, pagina's in de sitemap die een fout geven, en pagina's die niet in de sitemap staan ("na te kijken"). | midden / laag |
| `default-domain` | Default Domain: het domein in de sitemap of de canonical is niet het www-domein. "Na te kijken". | laag |
| `gtm` | GTM Set Up: geen Google Tag Manager ("na te kijken"), en trackers die buiten GTM geladen worden (gtag.js, Meta Pixel, Hotjar, LinkedIn, HubSpot, Clarity, …). | laag |
| `cms-slugs` | CMS Slugs: het pad van een CMS-template lijkt meervoud (bv. /projecten/). "Na te kijken". | laag |
| `redirects` | Redirects: pagina's van de oude site die op de nieuwe site geen pagina en geen redirect hebben (404 na de lancering). Enkel met een live domein. | hoog |
| `slugs` | Page and CMS Slugs: oude pagina's die via een redirect op een ander pad uitkomen. Enkel met een live domein. | laag |
| `seo-migration` | When Migrating - SEO Title & Description: pagina's met een andere titel of description dan op de oude site. Enkel met een live domein. | midden |
| `cms-fields` | CMS Fields: velden zonder helptekst, en velden die in geen enkel item ingevuld zijn ("na te kijken"). Webflow-lezer. | laag |
| `cms-items` | Dummy CMS Content: collecties met minder dan 3 items; een lege collectie is "na te kijken". Webflow-lezer. | midden |
| `cms-content` | Dummy CMS Content: items met opvultekst of een testnaam, ook items die nergens gelinkt zijn of nog draft zijn. Webflow-lezer. | hoog |
| `conditional-visibility` | Conditional Visibility: velden die in sommige items leeg zijn, zodat de template het element moet verbergen. "Na te kijken". Webflow-lezer. | midden |
| `page-names` | Page Names in Title Case: paginanamen in Webflow die niet in Title Case staan. Webflow-lezer. | laag |
| `draft-pages` | Missing Content: pagina's die nog als draft staan en dus niet mee online gaan. "Na te kijken". Webflow-lezer. | laag |
| `timezone` | Timezone: geen tijdzone, of een tijdzone die niet past bij het land van het live domein (bv. .be en niet Europe/Brussels). Zonder live domein "na te kijken". Webflow-lezer. | midden |

Afbeeldingen in de Webflow-badge en kaarttegels tellen niet mee voor alt-teksten, net als een lege alt in een link die al tekst heeft (bv. een pijltje naast "Lees meer").

### Live domein

Op staging verwijzen oude links vaak nog naar het live domein van de klant (bv. `https://www.klant.be/oude-pagina`). Na de lancering draait de nieuwe site op dat domein, dus de tool controleert zo'n link op de nieuwe site: bestaat `/oude-pagina` daar niet, dan is het een kapotte interne link (hoog). Het live domein komt uit `live_domain` bij `start_checkup`, of anders uit `sitemap.xml` als Webflow daar het live domein in zet. De samenvatting toont welk domein gebruikt is (`liveDomain`, `liveDomainSource`).

### Webflow-lezer

Met een Webflow-sitetoken leest de tool ook de gegevens uit Webflow zelf: de site (tijdzone), alle pagina's (ook drafts) en elke CMS-collectie met haar velden en items, tot 1000 items per collectie. Het token kan enkel lezen en staat in de serverinstellingen, niet in de chat:

1. In Webflow: Site settings > Apps & integrations > API access > Generate API token. Enkel een site-admin kan dat.
2. Geef het token een naam (bv. "Skrol check-up") en enkel deze scopes, allemaal Read-only: Sites, Pages en CMS.
3. Zet het token in Coolify bij de omgevingsvariabele `WEBFLOW_TOKENS`. Meerdere sites: tokens gescheiden door komma's. Herstart de app.

De tool kiest zelf het token van de site die gecontroleerd wordt: op staging aan de naam van het .webflow.io-subdomein, op een eigen domein aan de custom domains. Is er geen passend token, dan staan de controles van de Webflow-lezer in `skipped` met de reden. De samenvatting toont wat gelezen is in `webflow`. Een token vervalt na 365 dagen zonder gebruik; per site kunnen er 5 zijn.

Klassen, kleurvariabelen, interacties en symbolen zitten niet in de Data API van Webflow en blijven op de afvinklijst.

### SEO en migratie

De SEO-controles lezen de HTML zoals de server ze teruggeeft, dus wat een zoekmachine ziet. CMS-pagina's worden herkend aan hun Webflow-pagina-ID: alle items van een template delen dezelfde ID.

Is er een live domein, dan leest de tool ook de oude site die daar nu nog draait: de pagina's uit haar sitemap (ook via robots.txt en sitemap-indexen), of als er geen sitemap is, door haar links te volgen, met een maximum van 300 pagina's. Elk oud pad wordt op de nieuwe site opgevraagd: bestaat het, verwijst een redirect door, of geeft het een 404? Voor de pagina's die bestaan vergelijkt de tool de titel en de description met de oude. De samenvatting toont de cijfers in `migration`. Kan de oude site niet gelezen worden, dan staan de drie migratiecontroles in `skipped` met de reden, en niet in `coverage`.

Elke pagina wordt in Chromium geladen op 1440 px en één keer helemaal doorgescrold, zodat lazy afbeeldingen laden en scroll-animaties afspelen. Daarna wordt de pagina verkleind naar 1280, 992, 768, 390 en 360 px voor de scroll- en lay-outcontroles. Loopt een controle vast op een pagina, dan gaan de andere controles door en staat de fout bij die pagina in `list_pages`. Bevindingen die op meerdere pagina's voorkomen (bv. een favicon of een formulier in de footer) worden samengevoegd tot één bevinding met alle pagina's.

## Lokaal draaien

```bash
npm install
npm test                      # unit-, integratie- en MCP-tests op een testsite met geplante bugs
npm run checkup -- https://klant.webflow.io --live=klant.be   # check-up vanaf de commandolijn
npm run dev                   # MCP-server op http://localhost:8080/mcp
```

Gebruik je een Chromium die niet bij deze Playwright-versie hoort, zet dan `CHROMIUM_EXECUTABLE` op het pad ernaartoe.

## Instellingen

Alle instellingen gaan via omgevingsvariabelen; zie `.env.example`. De belangrijkste:

- `ALLOWED_DOMAINS`: domeinen die de tool als pagina mag openen. Standaard `*.webflow.io`. Voeg klantdomeinen toe, bv. `*.webflow.io,klant.be`.
- `MCP_PATH`: pad van de MCP-server. Kies een moeilijk te raden pad zolang er geen login is.
- `API_KEY`: als ingesteld, moet elke aanroep `x-api-key: <sleutel>` of `Authorization: Bearer <sleutel>` meesturen.
- `MAX_PAGES`: vangnet tegen eindeloze crawls (standaard 1000). De crawl negeert zoekparameters en volgt enkel links op hetzelfde domein.

## Beveiliging

- Elk verzoek van de browser en van de linkcontrole naar een intern adres (localhost, privénetwerken, het metadata-adres van de cloud) wordt geblokkeerd, ook na een redirect.
- De hoofdpagina mag enkel naar toegestane domeinen navigeren. Scripts en afbeeldingen van derden laden wel, anders klopt de weergave niet.
- Externe links worden niet in de browser geopend; enkel hun statuscode wordt opgevraagd.
- De oude site op het live domein wordt enkel met gewone verzoeken gelezen (geen browser, geen scripts), maximaal 300 pagina's.
- Deze versie vult geen formulieren in.

## Deployen met Coolify

1. Nieuwe resource in Coolify, bron: deze GitHub-repo, build pack: Dockerfile.
2. Omgevingsvariabelen zetten (minstens `ALLOWED_DOMAINS` en `MCP_PATH`, eventueel `API_KEY`).
3. Een persistent volume koppelen aan `/data`, zodat resultaten een herstart overleven.
4. Poort 8080 publiceren via de proxy van Coolify, met HTTPS.
5. In Claude als eigen connector toevoegen: `https://<adres>/<MCP_PATH>`.

De tag van de Playwright-image in de `Dockerfile` moet overeenkomen met de versie van `playwright` in `package.json`.

## Skill voor Claude

In `skill/webflow-checkup/SKILL.md` staat de skill die Claude vertelt hoe het de tools gebruikt: de werkwijze, de prioriteitsregels, het rapportformaat, de 74 punten van de pre-launch checklist en welke fixes Claude mag uitvoeren via de Webflow-connector. Alles staat in één bestand, zodat de skill in Claude in één keer op te slaan is. Wat niet in `coverage` staat, komt als afvinklijst onderaan het rapport.

Voor een volledige check-up in een gewone chat zijn nodig: de connector naar deze server (Checkup), de skill, en voor fixes de officiële Webflow-connector.

## Volgende stappen

Uit het technisch plan, in volgorde:

1. Overige browsercontroles uit de checklist-mapping: target en rel op externe links, eigen formuliervalidatie, interactiesnelheid, hoogte van afbeeldingen. Publicatie-instellingen (minify, secure frame headers) zijn op staging niet te zien.
2. Firefox en WebKit, Lighthouse.
3. Webflow-lezer, volgende stap: componenten per pagina (Navigation and Footer Symbols), sortering van CMS-lijsten.
4. Authenticatie (OAuth in plaats van een API-sleutel in de URL-instellingen).
