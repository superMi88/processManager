import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { DatabaseConfig } from "./resource-store";

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  dbId: string;
  database: string;
  path: string;
}

const BACKUPS_DIR = path.resolve(process.cwd(), "backups");

// Locate pg_dump / pg_restore
function getPgToolPath(tool: "pg_dump" | "pg_restore"): string {
  try {
    const { execSync } = require("child_process");
    execSync(`where ${tool}`, { stdio: "ignore" });
    return tool;
  } catch {
    const baseDir = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(baseDir)) {
      try {
        const versions = fs.readdirSync(baseDir);
        versions.sort((a, b) => parseFloat(b) - parseFloat(a));
        for (const ver of versions) {
          const exePath = path.join(baseDir, ver, "bin", `${tool}.exe`);
          if (fs.existsSync(exePath)) {
            return `"${exePath}"`;
          }
        }
      } catch {}
    }
  }
  return tool;
}

// Backup database
export function backupDatabase(db: DatabaseConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    if (db.type !== "postgres") {
      return reject(new Error("Backups werden aktuell nur für PostgreSQL unterstützt."));
    }

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0];
    const filename = `backup_${db.id}_${db.database}_${timestamp}.dump`;
    const backupPath = path.join(BACKUPS_DIR, filename);

    const pgDump = getPgToolPath("pg_dump");
    const cmd = `${pgDump} -h ${db.host} -p ${db.port} -U ${db.user} -F c -b -v -f "${backupPath}" ${db.database}`;

    const env = { ...process.env, PGPASSWORD: db.password || "" };

    exec(cmd, { env }, (error, stdout, stderr) => {
      if (error) {
        console.error("pg_dump failed:", stderr || error.message);
        // Clean up file if created partially
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        return reject(new Error(`pg_dump fehlgeschlagen: ${stderr || error.message}. Stelle sicher, dass PostgreSQL Client-Tools auf dem System installiert sind.`));
      }
      resolve(filename);
    });
  });
}

// Restore database
export function restoreDatabase(db: DatabaseConfig, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (db.type !== "postgres") {
      return reject(new Error("Restore wird aktuell nur für PostgreSQL unterstützt."));
    }

    const backupPath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(backupPath)) {
      return reject(new Error(`Backup-Datei '${filename}' wurde nicht gefunden.`));
    }

    const pgRestore = getPgToolPath("pg_restore");
    // --clean drops database objects before recreating them.
    // --no-owner avoids restore errors regarding database owner mismatches.
    // --no-privileges avoids privileges errors.
    const cmd = `${pgRestore} -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.database} --clean --no-owner --no-privileges "${backupPath}"`;

    const env = { ...process.env, PGPASSWORD: db.password || "" };

    exec(cmd, { env }, (error, stdout, stderr) => {
      if (error) {
        console.error("pg_restore failed:", stderr || error.message);
        return reject(new Error(`pg_restore fehlgeschlagen: ${stderr || error.message}`));
      }
      resolve();
    });
  });
}

// List backups
export async function listBackups(dbId?: string): Promise<BackupFileInfo[]> {
  if (!fs.existsSync(BACKUPS_DIR)) {
    return [];
  }

  try {
    const files = fs.readdirSync(BACKUPS_DIR);
    const backupFiles: BackupFileInfo[] = [];

    for (const file of files) {
      if (file.startsWith("backup_") && file.endsWith(".dump")) {
        const fullPath = path.join(BACKUPS_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          // Format filename: backup_dbId_dbname_timestamp.dump
          // E.g. backup_db-kisystem_kisystem_2026-06-27_04-53-00.dump
          const parts = file.slice(7, -5).split("_");
          
          const timePart = parts.pop() || "";
          const datePart = parts.pop() || "";
          const dbname = parts.pop() || "";
          const fileDbId = parts.join("_");

          if (dbId && fileDbId !== dbId) {
            continue;
          }

          backupFiles.push({
            filename: file,
            sizeBytes: stat.size,
            createdAt: stat.birthtime.toISOString(),
            dbId: fileDbId,
            database: dbname,
            path: fullPath
          });
        } catch {}
      }
    }

    // Sort descending by date
    backupFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return backupFiles;
  } catch (error) {
    console.error("Failed to list backups:", error);
    return [];
  }
}

// Delete backup
export async function deleteBackup(filename: string): Promise<void> {
  const backupPath = path.join(BACKUPS_DIR, filename);
  // Security check to avoid path traversal
  if (path.dirname(backupPath) !== BACKUPS_DIR) {
    throw new Error("Ungültiger Dateiname.");
  }
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}
