# Agent-Prompt: Aktualisierung / Erstellung der `process-manager.json`

Kopiere den folgenden Prompt-Text direkt in den Chat des AI-Agents im jeweiligen Ziel-Repository (z. B. Discord-Bot, Webseite oder Backend-Projekt).

---

```markdown
Du bist dafür zuständig, die Konfigurationsdatei `process-manager.json` im Root-Verzeichnis dieses Projekts zu erstellen bzw. auf den neuesten Standard des Process Managers zu migrieren.

### Kontext & Ziel
Der zentrale Process Manager steuert PM2-Prozesse, Datenbanken, Ports, Domains, Abhängigkeiten und `.env`-Dateien auf dem Server. 
Er erwartet im Root jedes Projekts eine `process-manager.json`. 
Der Standard verwendet **immer ein `services`-Array** (auch wenn das Repository nur einen einzigen Dienst enthält).

### Deine Aufgabe
1. Untersuche dieses Repository:
   - Welche Dienste/Komponenten gibt es? (z. B. nur ein Bot, nur eine API, oder beides: Bot + Dashboard/Webseite)
   - Gibt es Abhängigkeiten zu anderen Diensten auf dem Server? (z. B. Webseite funktioniert nur, wenn der Discord-Bot läuft)
   - Welche `.env`-Dateien werden verwendet und wo liegen sie? (z. B. `.env`, `./bot/.env`, `./website/.env`)
   - Welche Umgebungsvariablen werden benötigt? (Untersuche `.env.example`, `config.js`, `docker-compose.yml`, Prisma-Schemas etc.)
   - Welche PM2-Prozessnamen werden auf dem Server für diese Dienste verwendet oder empfohlen? (z. B. `discord-bot`, `discord-web`, `website-kleiner-wald`)
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
      "dependsOn": "<Optional: Name des abhängigen Projekts/Prozesses, z. B. Discord-Suite/Discord-Bot>",
      "requirements": [
        {
          "key": "PORT",
          "label": "Web Port",
          "type": "port",
          "defaultValue": "3001"
        },
        {
          "key": "NEXTAUTH_URL",
          "label": "OAuth / App Basis-URL",
          "type": "domain",
          "description": "Automatisch HTTPS-Domain oder localhost:PORT"
        },
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
- **`dependsOn`** *(string oder Array, optional)*: 
  - Gibt an, von welchem anderen Prozess oder Dienst dieser Service abhängt (z. B. `"Discord-Suite/Discord-Bot"` oder `"discordBot"`).
  - **Automatische DB-Vererbung**: Wenn `dependsOn` gesetzt ist, übernimmt der Service **vollautomatisch** die Datenbank des übergeordneten Dienstes! Du musst `DATABASE_URL` in diesem Fall nicht separat konfigurieren.
  - Für optionale Plugin-Abhängigkeiten kann auch ein Objekt übergeben werden:  
    `[{"process": "minecraft-server-manager", "plugin": "Stats-Sync", "required": false}]`
- **`requirements`** *(Array, erforderlich)*: Liste aller benötigten Umgebungsvariablen / Ressourcen.

#### Anforderungstypen (`type`):
- `"port"`: Ein Netzwerkport (z. B. `PORT`, optional mit `"defaultValue": "3000"`).
- `"domain"`: Eine Domain / App-URL (z. B. `NEXTAUTH_URL`, `PUBLIC_URL`, `APP_URL`, `DOMAIN`).  
  *Besonderheit:* Der Process Manager generiert hierfür automatisch die fertige `https://<domain>` (wenn eine Domain verknüpft ist) oder fällt nahtlos auf `http://localhost:<PORT>` zurück. Ideal für Discord/Google-OAuth Redirects!
- `"database"`: Eine eigenständige Datenbankverbindung (wenn NICHT über `dependsOn` geerbt). Bei bekanntem Typ gib `"dbType": "postgres"` oder `"dbType": "mongodb"` an.
- `"credential"` / `"secret"`: API-Keys, OAuth-Secrets oder Bot-Tokens (z. B. `DISCORD_TOKEN`, `GOOGLE_API_KEY`).

---

### Beispiele zur Orientierung

#### Beispiel 1: Einfaches Einzelprojekt (z. B. Minecraft API/Manager)
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
          "defaultValue": "3100"
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

#### Beispiel 2: Multi-Service Projekt (Discord-Bot + Web-Dashboard)
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
          "label": "MongoDB Datenbank",
          "type": "database",
          "dbType": "mongodb"
        }
      ]
    },
    {
      "name": "Web-Dashboard",
      "pm2Process": "discord-web",
      "envPath": "./website/.env",
      "dependsOn": "Discord-Bot",
      "requirements": [
        {
          "key": "PORT",
          "label": "Web Port",
          "type": "port",
          "defaultValue": "3001"
        },
        {
          "key": "NEXTAUTH_URL",
          "label": "NextAuth Basis-URL",
          "type": "domain"
        }
      ]
    }
  ]
}
```

#### Beispiel 3: Abhängiges Web-Projekt (Website hängt von Discord-Bot ab)
```json
{
  "name": "websiteKleinerWald",
  "repository": "superMi88/websiteKleinerWald",
  "category": "Webseiten",
  "services": [
    {
      "name": "Webseite",
      "pm2Process": "website-kleiner-wald",
      "envPath": ".env",
      "dependsOn": "Discord-Suite/Discord-Bot",
      "requirements": [
        {
          "key": "PORT",
          "label": "Web Port",
          "type": "port",
          "defaultValue": "3101"
        },
        {
          "key": "NEXTAUTH_URL",
          "label": "OAuth Basis-URL",
          "type": "domain",
          "description": "Automatisch HTTPS Domain oder Fallback auf localhost:3101"
        }
      ]
    }
  ]
}
```

*(Hinweis: Durch `dependsOn: "Discord-Suite/Discord-Bot"` erbt die Webseite automatisch die `DATABASE_URL` des Bots, ohne dass sie separat konfiguriert werden muss).*

Überprüfe nach Erstellung, dass das JSON syntaktisch gültig formatiert ist.
```
