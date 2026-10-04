# Friday Night Commander Bot

Überwacht [dd-munich.de/event-list](https://www.dd-munich.de/event-list) und postet automatisch in die
WhatsApp-Gruppe **potpod**, sobald das Event *Friday Night Commander* für den kommenden Freitag
online ist **und** 14 € kostet.

Läuft komplett kostenlos, ohne eigenen Server.

## Wie es funktioniert

```
Cloudflare Worker (Cron, alle 10 Min, Mi 00:00 – Fr 18:00 Europe/Berlin)
        │
        ├─ 1. event-list scrapen    → Events mit Titel "Friday Night Commander"
        ├─ 2. Detailseite scrapen   → JSON-LD mit Ticketpreisen
        ├─ 3. Bedingung prüfen      → Datum = kommender Freitag UND Preis = 14 €
        ├─ 4. Green API aufrufen    → Nachricht in die Gruppe, von deiner Nummer
        └─ 5. Marker in KV ablegen  → pro Freitag wird genau einmal gepostet
```

Die Entscheidungslogik liegt in [`src/core.ts`](src/core.ts) und wird von zwei Einstiegspunkten
genutzt: [`src/worker.ts`](src/worker.ts) für den Livebetrieb und [`src/index.ts`](src/index.ts) für
lokale Trockenläufe.

**Der eigentliche Trigger ist der Preis.** Das Event steht oft schon Wochen vorher online – aber mit
einem Dummybetrag von 140 €. Erst wenn der Veranstalter auf 14 € umstellt, ist es wirklich bestätigt.

**Warum Cloudflare und nicht GitHub Actions?** Der Bot lief zunächst auf GitHub Actions. Dessen
Zeitplan ist ausdrücklich unverbindlich, und am 01.10.2026 wurden statt 71 Läufen nur 8 gestartet,
mit Lücken von bis zu sieben Stunden. Die Meldung kam dadurch Stunden zu spät, und ein kompletter
Ausfall wäre nur eine Frage der Zeit gewesen. Cloudflare führt Cron-Trigger pünktlich aus. Der
Workflow unter `.github/workflows/` ist nur noch für manuelle Trockenläufe da.

**Warum kein Playwright/Selenium?** Die Wix-Seite ist server-gerendert, ein HTTP-Request genügt. Und
WhatsApp Web ließe sich ohne dauerhaft laufenden Browser samt Session nicht automatisieren.

## Betrieb

```bash
pnpm deploy                      # Worker ausrollen
pnpm tail                        # Live-Logs ansehen
pnpm dry-run                     # lokal gegen die Live-Seite, sendet nichts
pnpm typecheck
```

Der Worker hat einen per Token geschützten HTTP-Endpunkt für Diagnose und Tests. Ohne gültiges Token
antwortet er mit 404. `WORKER_TEST_TOKEN` steht in der lokalen `.env`.

| Aufruf | Wirkung |
|---|---|
| `?token=…&mode=status` | zeigt, welche Freitage bereits gemeldet wurden |
| `?token=…&mode=dry` | kompletter Durchlauf, sendet nichts |
| `?token=…&mode=test` | sendet wirklich, als Test markiert, an `TEST_CHAT_ID` statt in die Gruppe |
| `…&friday=2026-10-16` | prüft diesen Freitag statt des kommenden (nur in `dry` und `test`) |

## Konfiguration

Variablen stehen in [`wrangler.toml`](wrangler.toml), Geheimnisse setzt du mit
`wrangler secret put <NAME>`.

| Name | Art | Bedeutung |
|---|---|---|
| `EXPECTED_PRICE_EUR` | Variable | Preis, der das Event als bestätigt markiert (Standard 14) |
| `EVENT_TITLE` | Variable | gesuchter Titel, Präfix-Vergleich |
| `GREENAPI_BASE_URL` | Variable | apiUrl aus der Green-API-Konsole |
| `GREENAPI_ID_INSTANCE` | Secret | Instanz-ID |
| `GREENAPI_API_TOKEN` | Secret | Instanz-Token |
| `WHATSAPP_GROUP_ID` | Secret | Gruppen-ID, z. B. `1203…@g.us` |
| `TEST_CHAT_ID` | Secret | Empfänger für Testnachrichten |
| `WORKER_TEST_TOKEN` | Secret | schützt den HTTP-Endpunkt |

Die Gruppen-ID ermittelst du einmalig mit `pnpm find-group potpod`.

## Was du wissen solltest

- **Green API ist eine inoffizielle WhatsApp-Anbindung.** Metas offizielle Cloud API kann prinzipiell
  nicht in Gruppen posten – jede Gruppenlösung bewegt sich in dieser Grauzone. Ein kleines Restrisiko
  für deine Nummer bleibt. Deine ausgehenden Nachrichten laufen technisch über Green-API-Server.
- **Der kostenlose Green-API-Tarif erlaubt 3 Chats pro Monat.** Belegt sind die Gruppe und deine
  eigene Nummer für Tests.
- **Mehrere Termine am selben Freitag** werden in einer Nachricht zusammengefasst, mit Uhrzeit und
  Preis pro Termin.
- **Kein Monitoring.** Bricht das Scraping, weil Wix sein Markup ändert, fällt das nur auf, wenn keine
  Nachricht kommt. `pnpm tail` zeigt die Fehler.
- Wird das Event erst nach Freitag 18:00 eingestellt, kommt bewusst keine Nachricht mehr.
