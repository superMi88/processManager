import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { Client } from "pg";
import { 
  readStore, 
  writeStore,
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

function runCommandRaw(cmd: string, cwd: string, env: Record<string, string>): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const fullEnv = { ...process.env, ...env };
    exec(cmd, { cwd, env: fullEnv }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout || "",
        stderr: stderr || ""
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
      // Always use the superuser for migrations if configured, otherwise fallback to the selected app user
      const selectedUserObj = dbConfig.superuser || dbConfig.users?.find(u => u.id === projectLinks[`${dbReq.key}_USER`]) || dbConfig.users?.[0];
      const databaseUrl = buildDatabaseUrl(dbConfig, selectedUserObj);
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
          
          // Step 1: Generate migration SQL using "prisma migrate diff" (fully non-interactive)
          const diffCmd = `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`;
          const diffRes = await runCommandRaw(diffCmd, projectPath, envVars);
          if (!diffRes.success) {
            return NextResponse.json({
              success: false,
              output: `Erstellung der SQL-Migration fehlgeschlagen.\n\n--- STDOUT ---\n${diffRes.stdout}\n\n--- STDERR ---\n${diffRes.stderr}`
            });
          }

          // Step 2: Create directory and write migration.sql
          const now = new Date();
          const timestamp = now.getUTCFullYear().toString().padStart(4, "0") +
            (now.getUTCMonth() + 1).toString().padStart(2, "0") +
            now.getUTCDate().toString().padStart(2, "0") +
            now.getUTCHours().toString().padStart(2, "0") +
            now.getUTCMinutes().toString().padStart(2, "0") +
            now.getUTCSeconds().toString().padStart(2, "0");
          
          const folderName = `${timestamp}_${baselineName}`;
          const migrationsDir = path.join(projectPath, "prisma", "migrations");
          const migrationFolder = path.join(migrationsDir, folderName);
          
          fs.mkdirSync(migrationFolder, { recursive: true });
          fs.writeFileSync(path.join(migrationFolder, "migration.sql"), diffRes.stdout, "utf-8");

          // Step 3: Resolve the migration (mark it as applied in the database)
          const resolveCmd = `npx prisma migrate resolve --applied ${folderName}`;
          const resolveRes = await runCommand(resolveCmd, projectPath, envVars);
          
          return NextResponse.json({
            success: resolveRes.success,
            output: `Step 1: SQL-Migration erfolgreich generiert.\nStep 2: Migration-Datei erstellt in: prisma/migrations/${folderName}/migration.sql\n\nStep 3 (Resolve --applied):\n${resolveRes.output}`
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
          const backupUser = dbConfig.superuser || dbConfig.users?.find(u => u.username === "postgres" || u.username === "admin") || dbConfig.users?.[0];
          const createdFilename = await backupDatabase(dbConfig, backupUser);
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
          const restoreUser = dbConfig.superuser || dbConfig.users?.find(u => u.username === "postgres" || u.username === "admin") || dbConfig.users?.[0];
          await restoreDatabase(dbConfig, filename, restoreUser);
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

        const selectedUser = dbConfig.superuser || dbConfig.users?.find(u => u.username === "postgres" || u.username === "admin") || dbConfig.users?.[0];
        const client = new Client({
          host: dbConfig.host,
          port: dbConfig.port,
          user: selectedUser?.username || "postgres",
          password: selectedUser?.password || "",
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

        const selectedUser = dbConfig.superuser || dbConfig.users?.find(u => u.username === "postgres" || u.username === "admin") || dbConfig.users?.[0];
        const client = new Client({
          host: dbConfig.host,
          port: dbConfig.port,
          user: adminUser || selectedUser?.username || "postgres",
          password: typeof adminPassword === 'string' ? adminPassword : (selectedUser?.password || ""),
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

    // 4. Database-level Destructive Operations (Drop Database)
    if (action === "database-drop") {
      if (!dbId) {
        return NextResponse.json({ error: "Missing dbId parameter" }, { status: 400 });
      }

      const dbConfig = store.databases.find(d => d.id === dbId);
      if (!dbConfig) {
        return NextResponse.json({ error: "Datenbank nicht gefunden" }, { status: 404 });
      }

      if (dbConfig.type !== "postgres") {
        return NextResponse.json({ error: "Das komplette Löschen vom Server wird aktuell nur für PostgreSQL unterstützt." }, { status: 400 });
      }

      // Connect to postgres database to drop the target database
      const selectedUser = dbConfig.superuser || dbConfig.users?.find(u => u.username === "postgres" || u.username === "admin") || dbConfig.users?.[0];
      
      const client = new Client({
        host: dbConfig.host,
        port: dbConfig.port,
        user: selectedUser?.username || "postgres",
        password: selectedUser?.password || "",
        database: "postgres",
        connectionTimeoutMillis: 5000,
      });

      await client.connect();
      try {
        const safeDbName = dbConfig.database.replace(/"/g, '""');
        // Drop database with FORCE option to terminate active connections
        await client.query(`DROP DATABASE "${safeDbName}" WITH (FORCE);`);
      } finally {
        await client.end();
      }

      // Drop succeeded! Now remove from resources.json
      store.databases = store.databases.filter(d => d.id !== dbId);

      // Clean up links referencing deleted resource
      for (const projName of Object.keys(store.links)) {
        const projLinks = store.links[projName];
        for (const envKey of Object.keys(projLinks)) {
          if (projLinks[envKey] === dbId) {
            delete projLinks[envKey];
            delete projLinks[`${envKey}_USER`];
            delete projLinks[`${envKey}_MIGRATION_USER`];
          }
        }
      }

      const success = writeStore(store);
      if (!success) {
        return NextResponse.json({ error: "Datenbank wurde gelöscht, konnte aber nicht aus der Konfiguration entfernt werden." }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        message: `Datenbank '${dbConfig.database}' erfolgreich vom PostgreSQL-Server gelöscht und aus Konfiguration entfernt.` 
      });
    }

    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });

  } catch (error) {
    console.error("Database operations endpoint failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
