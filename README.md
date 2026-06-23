# PM2 Process Manager Dashboard

Ein passwortgeschütztes Web-Dashboard zur Verwaltung von PM2-Prozessen auf Basis von Next.js (App Router) und Vanilla CSS. Das Projekt läuft standardmäßig auf einem konfigurierbaren Port und verfügt über eine CI/CD-Pipeline für automatisches Deployment.

## Features
- **Prozesssteuerung:** PM2-Prozesse anzeigen, starten, stoppen und neustarten.
- **Terminal-Log-Viewer:** Live-Ansicht der stdout/stderr-Logs für jeden Prozess direkt im Webinterface.
- **Sichere Anmeldung:** Passwort- und E-Mail-Schutz per signiertem JWT-Cookie (keine Datenbank erforderlich, Credentials werden über `.env` verwaltet).
- **Entwicklungs-Mock-Modus:** Automatischer Fallback auf simulierte Prozesse, wenn lokal kein PM2-Daemon läuft.
- **Configurable Port:** Der Port ist flexibel über die Umgebungsvariablen anpassbar.

---

## Konfiguration

Erstelle eine `.env`-Datei im Hauptverzeichnis des Projekts (oder passe die vorhandene `.env` an). Eine Vorlage findest du unter `.env.example`:

```env
# Der Port, auf dem die App laufen soll (z. B. 3500 statt standardmäßig 3000)
PORT=3500

# Anmeldedaten für die Weboberfläche
AUTH_EMAIL=admin@admin.com
AUTH_PASSWORD=admin

# Mindestens 32-stelliger sicherer Schlüssel für JWT-Signaturen
AUTH_SECRET=super-secret-jwt-signing-key-32-characters-min

NODE_ENV=development
```

---

## Erste Schritte (Lokale Ausführung)

1. **Abhängigkeiten installieren:**
   ```bash
   npm install
   ```

2. **Entwicklungsserver starten:**
   ```bash
   npm run dev
   ```
   Die App startet automatisch auf dem in der `.env` konfigurierten Port (z. B. `http://localhost:3500`).

3. **Produktions-Build erstellen:**
   ```bash
   npm run build
   npm run start
   ```

---

## CI/CD & Deployment

Die App ist für automatisches Deployment per GitHub Actions vorbereitet:
- Der Workflow ist unter `.github/workflows/deploy.yml` konfiguriert.
- Bei jedem Push auf den Branch `main` wird der Code gebaut, verifiziert und per SSH auf deinen Server deployed.
- Auf dem Server wird die App automatisch per PM2 mit `pm2 reload process-manager` neu geladen.
