import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { Client } from "pg";
import { 
  readStore, 
  getDiscoveredProjects, 
  buildDatabaseUrl 
} from "@/lib/resource-store";
import { 
  backupDatabase, 
  restoreDatabase, 
  listBackups, 
  deleteBackup 
} from "@/lib/db-ops";

// Helper to run shell commands in a specific folder with environment variables
function runCommand(cmd: string, cwd: string, env: Record<string, string>): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const fullEnv = { ...process.env, ...env };
    exec(cmd, { cwd, env: fullEnv }, (error, stdout, stderr) => {
      const output = `--- STDOUT ---\n${stdout || ""}\n--- STDERR ---\n${stderr || ""}`;
      resolve({
        success: !error,
        output
      });
    });
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, projectName, dbId, migrationName, filename } = body;
    const store = readStore();

    if (!action) {
      return NextResponse.json({ error: "Missing action parameter" }, { status: 400 });
    }

    // 1. Prisma & Migration Operations (Project-related)
    if (action.startsWith("prisma-")) {
      if (!projectName) {
        return NextResponse.json({ error: "Missing projectName" }, { status: 400 });
      }

      const discovered = getDiscoveredProjects();
      const project = discovered.find(p => p.declaration.name === projectName);
      if (!project) {
        return NextResponse.json({ error: `Projekt '${projectName}' nicht gefunden.` }, { status: 404 });
      }

      // Check linked database
      const projectLinks = store.links[projectName] || {};
      // Find a requirement of type "database"
      const dbReq = project.declaration.requirements.find(r => r.type === "database");
      if (!dbReq) {
        return NextResponse.json({ error: `Projekt '${projectName}' erfordert keine Datenbank.` }, { status: 400 });
      }

      const linkedDbId = projectLinks[dbReq.key];
      if (!linkedDbId) {
        return NextResponse.json({ error: `Projekt '${projectName}' ist mit keiner Datenbank verknüpft.` }, { status: 400 });
      }

      const dbConfig = store.databases.find(d => d.id === linkedDbId);
      if (!dbConfig) {
        return NextResponse.json({ error: `Die verknüpfte Datenbank mit ID '${linkedDbId}' wurde nicht gefunden.` }, { status: 404 });
      }

      // Build database URL environment variable
      const databaseUrl = buildDatabaseUrl(dbConfig);
      const envVars: Record<string, string> = {};
      envVars[dbReq.key] = databaseUrl;

      const projectPath = project.projectPath;

      // Handle specific Prisma actions
      if (action === "prisma-status") {
        const res = await runCommand("npx prisma migrate status", projectPath, envVars);
        return NextResponse.json(res);
      } 
      
      else if (action === "prisma-push") {
        const res = await runCommand("npx prisma db push", projectPath, envVars);
        return NextResponse.json(res);
      } 
      
      else if (action === "prisma-generate") {
        const res = await runCommand("npx prisma generate", projectPath, envVars);
        return NextResponse.json(res);
      } 
      
      else if (action === "prisma-migrate") {
        if (!migrationName) {
          return NextResponse.json({ error: "Migrationsname erforderlich" }, { status: 400 });
        }
        // Validate name to prevent command injection
        if (!/^[a-zA-Z0-9_\-]+$/.test(migrationName)) {
          return NextResponse.json({ error: "Ungültiger Migrationsname. Nur Buchstaben, Zahlen und Unterstriche erlaubt." }, { status: 400 });
        }
        
        const res = await runCommand(`npx prisma migrate dev --name ${migrationName}`, projectPath, envVars);
        return NextResponse.json(res);
      } 
      
      else if (action === "prisma-baseline") {
        try {
          const baselineName = "initial_migration";
          
          // Step 1: Create the migration files (without applying to the DB)
          const createCmd = `npx prisma migrate dev --name ${baselineName} --create-only`;
          const createRes = await runCommand(createCmd, projectPath, envVars);
          if (!createRes.success) {
            return NextResponse.json({
              success: false,
              output: `Baseline-Erstellung fehlgeschlagen.\n\n${createRes.output}`
            });
          }

          // Step 2: Find the exact folder name of the newly created migration
          const migrationsDir = path.join(projectPath, "prisma", "migrations");
          if (!fs.existsSync(migrationsDir)) {
            return NextResponse.json({
              success: false,
              output: `Fehler: Migrationsverzeichnis '${migrationsDir}' wurde nicht erstellt.`
            });
          }

          const files = fs.readdirSync(migrationsDir);
          const folderName = files.find(f => f.endsWith(`_${baselineName}`) && fs.statSync(path.join(migrationsDir, f)).isDirectory());
          if (!folderName) {
            return NextResponse.json({
              success: false,
              output: `Fehler: Die erstellte Migrationsdatei für '${baselineName}' konnte nicht gefunden werden.`
            });
          }

          // Step 3: Resolve the migration (mark it as applied)
          const resolveCmd = `npx prisma migrate resolve --applied ${folderName}`;
          const resolveRes = await runCommand(resolveCmd, projectPath, envVars);
          
          return NextResponse.json({
            success: resolveRes.success,
            output: `Step 1 (Migration erstellen):\n${createRes.output}\n\nStep 2 (Ordner erkannt: ${folderName})\n\nStep 3 (Resolve --applied):\n${resolveRes.output}`
          });
        } catch (baselineErr) {
          return NextResponse.json({
            success: false,
            output: `Fehler beim Baselining: ${baselineErr instanceof Error ? baselineErr.message : String(baselineErr)}`
          });
        }
      } 
      
      else {
        return NextResponse.json({ error: "Ungültige Prisma-Aktion" }, { status: 400 });
      }
    }

    // 2. Backup & Restore Operations (Database-related)
    if (action.startsWith("backup-")) {
      if (action === "backup-list") {
        const backups = await listBackups(dbId || undefined);
        return NextResponse.json({ success: true, backups });
      }

      if (action === "backup-create") {
        if (!dbId) {
          return NextResponse.json({ error: "Missing dbId parameter" }, { status: 400 });
        }
        const dbConfig = store.databases.find(d => d.id === dbId);
        if (!dbConfig) {
          return NextResponse.json({ error: "Datenbank nicht gefunden" }, { status: 404 });
        }
        try {
          const createdFilename = await backupDatabase(dbConfig);
          return NextResponse.json({ success: true, filename: createdFilename, message: "Backup erfolgreich erstellt." });
        } catch (backupErr) {
          return NextResponse.json({ 
            success: false, 
            error: backupErr instanceof Error ? backupErr.message : String(backupErr) 
          }, { status: 500 });
        }
      }

      if (action === "backup-restore") {
        if (!dbId || !filename) {
          return NextResponse.json({ error: "Missing dbId or filename parameter" }, { status: 400 });
        }
        const dbConfig = store.databases.find(d => d.id === dbId);
        if (!dbConfig) {
          return NextResponse.json({ error: "Datenbank nicht gefunden" }, { status: 404 });
        }
        try {
          await restoreDatabase(dbConfig, filename);
          return NextResponse.json({ success: true, message: "Backup erfolgreich wiederhergestellt." });
        } catch (restoreErr) {
          return NextResponse.json({ 
            success: false, 
            error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr) 
          }, { status: 500 });
        }
      }

      if (action === "backup-delete") {
        if (!filename) {
          return NextResponse.json({ error: "Missing filename parameter" }, { status: 400 });
        }
        try {
          await deleteBackup(filename);
          return NextResponse.json({ success: true, message: "Backup erfolgreich gelöscht." });
        } catch (deleteErr) {
          return NextResponse.json({ 
            success: false, 
            error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr) 
          }, { status: 500 });
        }
      }

      return NextResponse.json({ error: "Ungültige Backup-Aktion" }, { status: 400 });
    }

    // 3. User & Permissions Operations
    if (action.startsWith("user-")) {
      if (action === "user-list") {
        if (!dbId) {
          return NextResponse.json({ error: "Missing dbId parameter" }, { status: 400 });
        }
        const dbConfig = store.databases.find(d => d.id === dbId);
        if (!dbConfig) {
          return NextResponse.json({ error: "Datenbank nicht gefunden" }, { status: 404 });
        }
        if (dbConfig.type !== "postgres") {
          return NextResponse.json({ error: "Benutzerverwaltung wird aktuell nur für PostgreSQL unterstützt." }, { status: 400 });
        }

        const client = new Client({
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.database,
          connectionTimeoutMillis: 5000,
        });
        await client.connect();
        try {
          const sql = "SELECT rolname as username, rolcreatedb as cancreatedb, rolsuper as issuperuser FROM pg_roles WHERE rolcanlogin = true ORDER BY rolname;";
          const result = await client.query(sql);
          return NextResponse.json({ success: true, users: result.rows });
        } finally {
          await client.end();
        }
      }

      if (action === "user-toggle-createdb") {
        const { username, enabled, adminUser, adminPassword } = body;
        if (!dbId || !username) {
          return NextResponse.json({ error: "Missing dbId or username parameter" }, { status: 400 });
        }

        // Validate username to prevent SQL injection
        if (!/^[a-zA-Z0-9_\-]+$/.test(username)) {
          return NextResponse.json({ error: "Ungültiger Benutzername." }, { status: 400 });
        }

        const dbConfig = store.databases.find(d => d.id === dbId);
        if (!dbConfig) {
          return NextResponse.json({ error: "Datenbank nicht gefunden" }, { status: 404 });
        }
        if (dbConfig.type !== "postgres") {
          return NextResponse.json({ error: "Berechtigungen werden aktuell nur für PostgreSQL unterstützt." }, { status: 400 });
        }

        const client = new Client({
          host: dbConfig.host,
          port: dbConfig.port,
          user: adminUser || dbConfig.user,
          password: adminPassword !== undefined ? adminPassword : dbConfig.password,
          database: dbConfig.database,
          connectionTimeoutMillis: 5000,
        });

        await client.connect();
        try {
          const sql = `ALTER ROLE "${username.replace(/"/g, '""')}" ${enabled ? "CREATEDB" : "NOCREATEDB"};`;
          await client.query(sql);
          return NextResponse.json({ success: true, message: `Berechtigung für ${username} erfolgreich aktualisiert.` });
        } finally {
          await client.end();
        }
      }

      return NextResponse.json({ error: "Ungültige Benutzer-Aktion" }, { status: 400 });
    }

    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });

  } catch (error) {
    console.error("Database operations endpoint failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
