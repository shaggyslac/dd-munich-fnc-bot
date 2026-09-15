# Friday Night Commander Bot

Überwacht [dd-munich.de/event-list](https://www.dd-munich.de/event-list) und postet automatisch in die
WhatsApp-Gruppe **potpod**, sobald das Event *Friday Night Commander* für den kommenden Freitag
online ist **und** 14 € kostet.

Läuft komplett kostenlos, ohne eigenen Server.

## Wie es funktioniert

```
GitHub Actions (alle 10 Min, Mi 00:00 – Fr 18:00)
        │
        ├─ 1. event-list scrapen        → Events mit Titel "Friday Night Commander"
        ├─ 2. Detailseite scrapen       → JSON-LD mit Ticketpreisen
        ├─ 3. Bedingung prüfen          → Datum = kommender Freitag UND Preis = 14 €
        ├─ 4. Green API aufrufen        → Nachricht in die Gruppe, von deiner Nummer
        └─ 5. state/posted.json commiten → pro Freitag wird genau einmal gepostet
```

**Warum kein Playwright/Selenium?** Die Wix-Seite ist server-gerendert – ein simpler HTTP-Request
genügt, kein Browser nötig. Und WhatsApp Web lässt sich in GitHub Actions nicht sinnvoll
automatisieren: Die Session liegt im Browser-Profil, jeder Lauf startet in einem frischen Container
mit neuer IP, WhatsApp wirft die Session dabei zuverlässig raus.

**Der eigentliche Trigger ist der Preis.** Das Event steht oft schon Wochen vorher online – aber mit
einem Dummybetrag von 140 €. Erst wenn der Veranstalter auf 14 € umstellt, ist es wirklich bestätigt.
Genau darauf wartet der Bot.

## Einrichtung

Vier Schritte, danach läuft es von allein.

### 1. Green API einrichten (kostenlos)

1. Auf [console.green-api.com](https://console.green-api.com) registrieren.
2. Instanz im Tarif **Developer** anlegen (kostenlos: 1 Instanz, 3 Chats, unbegrenzt Nachrichten).
3. QR-Code scannen: WhatsApp → *Einstellungen → Verknüpfte Geräte → Gerät hinzufügen*.
4. `idInstance` und `apiTokenInstance` aus der Konsole notieren.

### 2. Gruppen-ID herausfinden

Der Gruppenname reicht nicht, WhatsApp adressiert über eine ID:

```bash
GREENAPI_ID_INSTANCE=... GREENAPI_API_TOKEN=... pnpm find-group potpod
```

Gibt etwas aus wie `120363012345678901@g.us   potpod   <-- das ist sie`.

### 3. Repository anlegen

```bash
gh repo create dd-munich-fnc-bot --public --source=. --push
```

**Public**, nicht private: öffentliche Repos haben unbegrenzte Actions-Minuten. Im Code stehen keine
Geheimnisse, die Zugangsdaten liegen in GitHub Secrets.

### 4. Secrets setzen

```bash
gh secret set GREENAPI_ID_INSTANCE   # idInstance aus Schritt 1
gh secret set GREENAPI_API_TOKEN     # apiTokenInstance aus Schritt 1
gh secret set WHATSAPP_GROUP_ID      # z.B. 120363012345678901@g.us
```

Fertig. Der Workflow startet automatisch ab dem nächsten Mittwoch.

## Testen

```bash
pnpm dry-run     # gegen die Live-Seite, zeigt nur an, sendet nichts
pnpm typecheck
```

Einen echten Testlauf inklusive Versand startest du über *Actions → Friday Night Commander Watcher →
Run workflow*, mit `dry_run = false`.

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `EXPECTED_PRICE_EUR` | `14` | Preis, der das Event als bestätigt markiert |
| `EVENT_TITLE` | `Friday Night Commander` | Gesuchter Titel (Präfix-Match) |
| `EVENT_LIST_URL` | `…/event-list` | Quelle |
| `DRY_RUN` / `IGNORE_WINDOW` / `IGNORE_PRICE` | aus | Testschalter |

Ändert der Veranstalter den Preis dauerhaft, reicht ein Repository-Variable-Update:
`gh variable set EXPECTED_PRICE_EUR --body 16`.

## Was du wissen solltest

- **Green API ist eine inoffizielle WhatsApp-Anbindung.** Metas offizielle Cloud API kann prinzipiell
  nicht in Gruppen posten – jede Gruppenlösung bewegt sich in dieser Grauzone. Ein kleines Restrisiko
  für deine Nummer bleibt. Deine ausgehenden Nachrichten laufen technisch über Green-API-Server.
- **GitHub-Cron ist nicht sekundengenau.** Bei Last verzögern sich Läufe um 10–20 Minuten. Bei einem
  Zeitfenster von zweieinhalb Tagen ist das folgenlos.
- **Mehrere Termine am selben Freitag** werden in einer Nachricht zusammengefasst, mit Uhrzeit und
  Preis pro Termin.
- **Kein Monitoring.** Bricht das Scraping, weil Wix sein Markup ändert, fällt das nur auf, wenn keine
  Nachricht kommt. Die Actions-Logs zeigen den Fehler.
- Wird das Event erst nach Freitag 18:00 eingestellt, kommt bewusst keine Nachricht mehr.
