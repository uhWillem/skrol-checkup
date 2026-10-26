# skrol-checkup

MCP-server voor de Webflow check-up bot van Skrol. De server crawlt een site in een headless Chromium, voert vaste controles uit uit de pre-launch checklist, en geeft de bevindingen aan Claude. Er zit geen AI in de server: dezelfde site geeft elke keer dezelfde bevindingen. Claude beoordeelt en schrijft het rapport.

Zie het technisch plan voor de volledige architectuur. Dit is de eerste versie (dag 1).

## Tools

| Tool | Wat ze doet |
| --- | --- |
| `start_checkup` | Start een check-up voor een URL als achtergrondtaak en geeft een job-ID terug. |
| `get_checkup_status` | Status en voortgang; als de job klaar is, een samenvatting en de lijst gecontroleerde checklist-punten. |
| `get_findings` | Bevindingen, gesorteerd op prioriteit, te filteren op controle, pagina of prioriteit, per 100. |

## Wat deze versie controleert

| Controle | Checklist-punt | Prioriteit |
| --- | --- | --- |
| `broken-links` | Linking Pages: interne links (hoog) en externe links (midden) met HTTP 4xx/5xx, time-out of onbestaand domein. Sites die bots weren (401, 403, 429, 999) krijgen "na te kijken". | hoog / midden |
| `empty-links` | Linking Pages: links met `href=""`, `"#"` of `javascript:`. Lightbox-, dropdown- en tablinks tellen niet mee. | midden |
| `heading-1` | Heading 1: geen of meer dan één h1. | hoog |
| `heading-structure` | Heading Structure: overgeslagen niveaus. | laag |
| `horizontal-scroll` | Horizontal Scroll: de pagina scrolt horizontaal op een van de viewports. Overloop die verborgen wordt door overflow op html of body: "na te kijken". | hoog |
| `image-alt` | Image Alt Texts: geen alt-attribuut of een bestandsnaam als alt. Lege alt op zichtbare afbeeldingen: "na te kijken". | midden |
| `missing-content` | Missing Content: lorem ipsum, Webflow-standaardteksten, placeholderafbeeldingen. | hoog |
| `form-success-message` | Form Success Message: standaardtekst van Webflow. | hoog |
| `form-error-message` | Form Error Message: standaardtekst van Webflow. | hoog |
| `form-name` | Form Settings: formulier heet "Email Form" of heeft geen naam. | midden |
| `form-inputs` | Input Settings: standaardnamen (Field, Field 2) en e-mail- of telefoonvelden met het verkeerde type. | midden |
| `empty-state` | Empty CMS List State: standaardtekst "No items found.". | midden |
| `favicon` | Favicon and Web Clip: ontbrekend of het Webflow-standaardicoon. | midden / laag |
| `webflow-badge` | Remove Webflow Branding: de badge staat op de pagina. | hoog |
| `lang` | Language Code: geen of een ongeldig lang-attribuut. | midden |

Elke pagina wordt in Chromium geladen op 1440 px en daarna verkleind naar 1280, 992, 768, 390 en 360 px voor de scrollcontrole. Bevindingen die op meerdere pagina's voorkomen (bv. een favicon of een formulier in de footer) worden samengevoegd tot één bevinding met alle pagina's.

## Lokaal draaien

```bash
npm install
npm test                      # unit-, integratie- en MCP-tests op een testsite met geplante bugs
npm run checkup -- https://klant.webflow.io   # check-up vanaf de commandolijn
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
- Deze versie vult geen formulieren in.

## Deployen met Coolify

1. Nieuwe resource in Coolify, bron: deze GitHub-repo, build pack: Dockerfile.
2. Omgevingsvariabelen zetten (minstens `ALLOWED_DOMAINS` en `MCP_PATH`, eventueel `API_KEY`).
3. Een persistent volume koppelen aan `/data`, zodat resultaten een herstart overleven.
4. Poort 8080 publiceren via de proxy van Coolify, met HTTPS.
5. In Claude als eigen connector toevoegen: `https://<adres>/<MCP_PATH>`.

De tag van de Playwright-image in de `Dockerfile` moet overeenkomen met de versie van `playwright` in `package.json`.

## Skill voor Claude

In `skill/webflow-checkup/` staat de skill die Claude vertelt hoe het de tools gebruikt: de werkwijze, de prioriteitsregels, het rapportformaat en welke fixes Claude mag uitvoeren via de Webflow-connector. `references/checklist.md` bevat alle 74 punten uit de pre-launch checklist; wat niet in `coverage` staat, komt als afvinklijst onderaan het rapport.

## Volgende stappen

Uit het technisch plan, in volgorde:

1. Docker op de VPS via Coolify, connector in Claude, eerste versie van de skill, eerste run op een afgerond project.
2. Overige controles uit de checklist-mapping.
3. Firefox en WebKit, Lighthouse.
4. Webflow-lezer (Data API v2 met een token met enkel leesrechten).
5. Authenticatie (API-sleutel via request headers of OAuth).
6. `get_screenshot` en `list_pages`.
