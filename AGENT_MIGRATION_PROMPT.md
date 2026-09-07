# Agent-Prompt: Aktualisierung / Erstellung der `process-manager.json`

Kopiere den folgenden Prompt-Text direkt in den Chat des AI-Agents im jeweiligen Ziel-Repository (z. B. Discord-Bot, Webseite oder Backend-Projekt).

---

```markdown
Du bist dafür zuständig, die Konfigurationsdatei `process-manager.json` im Root-Verzeichnis dieses Projekts zu erstellen bzw. auf den neuesten Standard des Process Managers zu migrieren.

### Kontext & Ziel
Der zentrale Process Manager steuert PM2-Prozesse, Datenbanken, Ports, Domains und `.env`-Dateien auf dem Server. 
Er erwartet im Root jedes Projekts eine `process-manager.json`. 
Der Standard verwendet **immer ein `services`-Array** (auch wenn das Repository nur einen einzigen Dienst enthält).

### Deine Aufgabe
1. Untersuche dieses Repository:
   - Welche Dienste/Komponenten gibt es? (z. B. nur ein Bot, nur eine API, oder beides: Bot + Dashboard/Webseite)
   - Welche `.env`-Dateien werden verwendet und wo liegen sie? (z. B. `.env`, `./bot/.env`, `./website/.env`)
   - Welche Umgebungsvariablen werden benötigt? (Untersuche `.env.example`, `config.js`, `docker-compose.yml`, Prisma-Schemas etc.)
   - Welche PM2-Prozessnamen werden auf dem Server für diese Dienste verwendet oder empfohlen? (z. B. `discord-bot`, `discord-web`)
   - Welches GitHub-Repository gehört dazu? (Prüfe `git remote -v` oder `package.json`)

2. Erstelle oder aktualisiere die Datei `process-manager.json` im Root-Verzeichnis exakt nach folgendem Schema:

```json
{
  "name": "<Projekt-Name>",
  "repository": "<owner/repo-name>",
  "category": "<Kategorie, z. B. Discord Bots, Webseiten, Tools>",
  "services": [
    {
      "name": "<Dienstname 1>",
      "pm2Process": "<exakter PM2-Prozessname auf dem Server>",
      "envPath": "<relativer Pfad zur .env-Datei, z. B. .env oder ./bot/.env>",
      "requirements": [
        {
          "key": "DATABASE_URL",
          "label": "PostgreSQL Verbindung",
          "type": "database",
          "dbType": "postgres",
          "description": "Verbindung zur PostgreSQL Datenbank"
        },
        {
          "key": "DISCORD_TOKEN",
          "label": "Discord Bot Token",
          "type": "secret",
          "description": "Geheimer Token aus dem Discord Developer Portal"
        }
      ]
    }
  ]
}
```

### Spezifikation der Felder:

#### Root-Ebene:
- **`name`** *(string, erforderlich)*: Name des Gesamtsystems/Projekts.
- **`repository`** *(string, empfohlen)*: GitHub-Repository im Format `owner/repo` (z. B. `superMi88/servernew`).
- **`category`** *(string, optional)*: Kategorie zur Gruppierung im Manager.
- **`services`** *(Array, erforderlich)*: Liste aller Services in diesem Repository.

#### Service-Ebene (`services[...]`):
- **`name`** *(string, erforderlich)*: Name des Services (z. B. `"Bot"`, `"Webseite"` oder der Projektname bei Einzelprojekten).
- **`pm2Process`** *(string, erforderlich)*: Der exakte Name, unter dem der Prozess in PM2 läuft (`pm2 list`).
- **`envPath`** *(string, erforderlich)*: Relativer Pfad zur Zieldatei, in die der Process Manager die Umgebungsvariablen schreiben soll (z. B. `".env"`, `"./bot/.env"`, `"./website/.env"`).
- **`requirements`** *(Array, erforderlich)*: Liste aller benötigten Umgebungsvariablen / Ressourcen.

#### Anforderungstypen (`type`):
- `"database"`: Eine Datenbankverbindung. Wenn bekannt, gib `"dbType": "postgres"` oder `"dbType": "mongodb"` an.
- `"port"`: Ein Netzwerkport (z. B. `PORT`, optional mit `"defaultValue": "3000"`).
- `"domain"`: Eine Domain / Subdomain (z. B. `NEXT_PUBLIC_APP_URL`, `DOMAIN`).
- `"credential"` / `"secret"`: API-Keys, OAuth-Secrets oder Bot-Tokens (z. B. `DISCORD_TOKEN`, `GOOGLE_API_KEY`).

---

### Beispiele zur Orientierung

#### Beispiel 1: Einfaches Einzelprojekt (z. B. API oder Bot)
```json
{
  "name": "Minecraft-Server-Manager",
  "repository": "superMi88/minecraftServerManager",
  "category": "Gaming Tools",
  "services": [
    {
      "name": "Minecraft-Manager",
      "pm2Process": "minecraft-manager",
      "envPath": ".env",
      "requirements": [
        {
          "key": "PORT",
          "label": "Web Port",
          "type": "port",
          "defaultValue": "3001"
        },
        {
          "key": "DATABASE_URL",
          "label": "MongoDB Datenbank",
          "type": "database",
          "dbType": "mongodb"
        }
      ]
    }
  ]
}
```

#### Beispiel 2: Multi-Service Projekt (z. B. Discord-Bot + Webseite im selben Repo)
```json
{
  "name": "Discord-Suite",
  "repository": "superMi88/servernew",
  "category": "Discord Bots",
  "services": [
    {
      "name": "Discord-Bot",
      "pm2Process": "discord-bot",
      "envPath": "./bot/.env",
      "requirements": [
        {
          "key": "DISCORD_TOKEN",
          "label": "Discord Bot Token",
          "type": "secret"
        },
        {
          "key": "DATABASE_URL",
          "label": "PostgreSQL DB",
          "type": "database",
          "dbType": "postgres"
        }
      ]
    },
    {
      "name": "Web-Dashboard",
      "pm2Process": "discord-web",
      "envPath": "./website/.env",
      "requirements": [
        {
          "key": "PORT",
          "label": "Web Port",
          "type": "port",
          "defaultValue": "3005"
        },
        {
          "key": "DOMAIN",
          "label": "Webseite Domain",
          "type": "domain"
        },
        {
          "key": "DATABASE_URL",
          "label": "PostgreSQL DB",
          "type": "database",
          "dbType": "postgres"
        }
      ]
    }
  ]
}
```

Überprüfe nach Erstellung, dass das JSON syntaktisch gültig formatiert ist.
```
