// Shim process.getBuiltinModule for Node versions where bson/mongodb requires it
if (typeof process !== "undefined") {
  const procObj = process as unknown as { getBuiltinModule?: () => unknown };
  if (!procObj.getBuiltinModule) {
    procObj.getBuiltinModule = () => ({});
  }
}

import { Client } from "pg";
import net from "net";
import fs from "fs";
import path from "path";

export interface DatabaseInfo {
  type: "postgres" | "mongodb" | "unknown";
  name: string;
  host: string;
  user: string;
  sourceProcess: string;
  status: "online" | "offline";
  sizeBytes: number;
  connectionCount?: number;
  tablesCount?: number;
  collectionsCount?: number;
  documentsCount?: number;
  maskedUri: string;
  error?: string;
}

// Helper to check if a TCP port is open
function isPortOpen(host: string, port: number, timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let open = false;

    socket.setTimeout(timeout);

    socket.connect(port, host, () => {
      open = true;
      socket.end();
    });

    socket.on("timeout", () => {
      socket.destroy();
    });

    socket.on("error", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      resolve(open);
    });
  });
}

// Helper to mask credentials
function maskConnectionString(uri: string): { host: string; database: string; user: string; maskedUri: string } {
  try {
    let cleanUri = uri;
    if (uri.startsWith("postgres://")) {
      cleanUri = uri.replace("postgres://", "http://");
    } else if (uri.startsWith("postgresql://")) {
      cleanUri = uri.replace("postgresql://", "http://");
    } else if (uri.startsWith("mongodb://")) {
      cleanUri = uri.replace("mongodb://", "http://");
    } else if (uri.startsWith("mongodb+srv://")) {
      cleanUri = uri.replace("mongodb+srv://", "http://");
    }

    const parsed = new URL(cleanUri);
    const host = parsed.host;
    const user = parsed.username || "default";
    const database = parsed.pathname.substring(1) || "default";
    
    const protocol = uri.substring(0, uri.indexOf("://") + 3);
    const authPart = parsed.username ? `${parsed.username}${parsed.password ? ":*****" : ""}@` : "";
    const maskedUri = `${protocol}${authPart}${host}/${database}${parsed.search}`;
    
    return { host, database, user, maskedUri };
  } catch {
    console.error("Failed to parse URI:", uri);
    return { host: "unknown", database: "unknown", user: "unknown", maskedUri: "invalid-uri" };
  }
}

// Crawl workspace sibling folders to discover database connection strings in .env files
function discoverUrisFromEnvFiles(): { uri: string; source: string }[] {
  const discovered: { uri: string; source: string }[] = [];
  
  // Read current .env file
  try {
    const localEnvPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(localEnvPath)) {
      const content = fs.readFileSync(localEnvPath, "utf-8");
      parseEnvContent(content, "processManager").forEach(uri => discovered.push(uri));
    }
  } catch (e) {
    console.error("Failed to read local env file:", e);
  }

  // Scan sibling folders
  const parentDir = path.resolve(process.cwd(), "..");
  try {
    if (fs.existsSync(parentDir)) {
      const dirs = fs.readdirSync(parentDir);
      for (const dir of dirs) {
        if (dir === "processManager") continue; // already checked
        const fullDir = path.join(parentDir, dir);
        try {
          const stat = fs.statSync(fullDir);
          if (stat.isDirectory()) {
            const envPath = path.join(fullDir, ".env");
            if (fs.existsSync(envPath)) {
              const content = fs.readFileSync(envPath, "utf-8");
              parseEnvContent(content, dir).forEach(uri => discovered.push(uri));
            }
          }
        } catch {
          // Ignore files or directories that raise stat errors
        }
      }
    }
  } catch (e) {
    console.error("Failed to scan sibling directories for env files:", e);
  }
  
  return discovered;
}

// Parse lines of a .env file and extract connection URIs
function parseEnvContent(content: string, projectName: string): { uri: string; source: string }[] {
  const results: { uri: string; source: string }[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      
      const connectionKeys = ["DATABASE_URL", "MONGODB_URI", "MONGO_URL", "MONGO_URI"];
      if (connectionKeys.includes(key) && val.includes("://")) {
        results.push({ uri: val, source: projectName });
      }
    }
  }
  return results;
}

// Retrieve stats for PostgreSQL database(s)
async function getPostgresStats(connectionString: string): Promise<Partial<DatabaseInfo>[]> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    
    const currDbRes = await client.query("SELECT current_database() as db");
    const currentDb = currDbRes.rows[0]?.db || "postgres";
    
    interface PostgresDbRow {
      name: string;
      size_bytes: string | number;
      connection_count: string | number;
    }
    let rows: PostgresDbRow[] = [];
    try {
      // Fetch size and connections for all non-system databases in this cluster
      const dbsRes = await client.query(`
        SELECT 
          d.datname as name, 
          pg_database_size(d.datname) as size_bytes,
          (SELECT count(*) FROM pg_stat_activity WHERE datname = d.datname) as connection_count
        FROM pg_database d
        WHERE d.datistemplate = false AND d.datname NOT IN ('postgres', 'template1', 'template2')
      `);
      rows = dbsRes.rows;
    } catch {
      // Fallback: If permissions prevent reading pg_database, query the connected database
      const sizeRes = await client.query("SELECT pg_database_size(current_database()) as size_bytes");
      const sizeBytes = parseInt(sizeRes.rows[0]?.size_bytes || "0", 10);
      
      const connRes = await client.query(
        "SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()"
      );
      const connectionsCount = parseInt(connRes.rows[0]?.count || "0", 10);
      
      rows = [{
        name: currentDb,
        size_bytes: sizeBytes,
        connection_count: connectionsCount
      }];
    }
    
    const results: Partial<DatabaseInfo>[] = [];
    for (const row of rows) {
      const dbName = row.name;
      const sizeBytes = parseInt(row.size_bytes || "0", 10);
      const connectionsCount = parseInt(row.connection_count || "0", 10);
      
      let tablesCount = 0;
      if (dbName === currentDb) {
        try {
          const tablesRes = await client.query(
            "SELECT count(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
          );
          tablesCount = parseInt(tablesRes.rows[0]?.count || "0", 10);
        } catch {}
      }
      
      results.push({
        name: dbName,
        status: "online",
        sizeBytes,
        connectionCount: connectionsCount,
        tablesCount: dbName === currentDb ? tablesCount : undefined,
      });
    }
    
    await client.end();
    return results;
  } catch (error) {
    try {
      await client.end();
    } catch {}
    throw error;
  }
}

// Retrieve stats for MongoDB database(s)
async function getMongoStats(connectionString: string): Promise<Partial<DatabaseInfo>[]> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    
    const cleanUri = connectionString.startsWith("mongodb+srv://")
      ? connectionString.replace("mongodb+srv://", "http://")
      : connectionString.replace("mongodb://", "http://");
    const parsed = new URL(cleanUri);
    const dbName = parsed.pathname.substring(1) || "";
    
    const results: Partial<DatabaseInfo>[] = [];
    if (dbName) {
      const db = client.db(dbName);
      const stats = await db.command({ dbStats: 1 });
      results.push({
        name: dbName,
        status: "online",
        sizeBytes: stats.dataSize || 0,
        collectionsCount: stats.collections || 0,
        documentsCount: stats.objects || 0,
      });
    } else {
      // List all user databases
      const adminDb = client.db().admin();
      const list = await adminDb.listDatabases();
      for (const dbInfo of list.databases) {
        if (dbInfo.name === "admin" || dbInfo.name === "config" || dbInfo.name === "local") continue;
        try {
          const db = client.db(dbInfo.name);
          const stats = await db.command({ dbStats: 1 });
          results.push({
            name: dbInfo.name,
            status: "online",
            sizeBytes: stats.dataSize || 0,
            collectionsCount: stats.collections || 0,
            documentsCount: stats.objects || 0,
          });
        } catch {}
      }
      
      if (results.length === 0) {
        results.push({
          name: "test",
          status: "online",
          sizeBytes: 0,
          collectionsCount: 0,
          documentsCount: 0,
        });
      }
    }
    
    await client.close();
    return results;
  } catch (error) {
    try {
      await client.close();
    } catch {}
    throw error;
  }
}

export async function scanDatabases(): Promise<DatabaseInfo[]> {
  const detectedDatabases: DatabaseInfo[] = [];

  // 1. Gather all connection URIs from workspace environment config files
  const discovered = discoverUrisFromEnvFiles();

  // 2. Add fallback targets for standard database setups
  const fallbacks = [
    { uri: "postgresql://postgres:postgres@localhost:5432/postgres", source: "system-default" },
    { uri: "postgresql://admin:password123@localhost:5435/kisystem?schema=public", source: "system-default" },
    { uri: "mongodb://localhost:27017", source: "system-default" }
  ];

  // Merge discovered envs and fallbacks
  const allTargetsMap = new Map<string, { uri: string; source: string; isFallback: boolean }>();
  
  discovered.forEach((item) => {
    allTargetsMap.set(item.uri, { ...item, isFallback: false });
  });
  
  fallbacks.forEach((item) => {
    // If we already have this URI or a highly similar one, skip adding the fallback
    if (!allTargetsMap.has(item.uri)) {
      allTargetsMap.set(item.uri, { ...item, isFallback: true });
    }
  });

  const targets = Array.from(allTargetsMap.values());

  // 3. Scan and probe each target
  for (const target of targets) {
    const { uri, source, isFallback } = target;
    
    let type: "postgres" | "mongodb" | "unknown" = "unknown";
    let cleanUri = uri;
    if (uri.startsWith("postgres://") || uri.startsWith("postgresql://")) {
      cleanUri = uri.replace("postgres://", "http://").replace("postgresql://", "http://");
      type = "postgres";
    } else if (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://")) {
      cleanUri = uri.replace("mongodb://", "http://").replace("mongodb+srv://", "http://");
      type = "mongodb";
    }

    if (type === "unknown") continue;

    try {
      const parsed = new URL(cleanUri);
      const hostname = parsed.hostname || "localhost";
      const port = parsed.port ? parseInt(parsed.port, 10) : (type === "postgres" ? 5432 : 27017);
      
      const { host, database, user, maskedUri } = maskConnectionString(uri);

      // Check if host port is listening
      const portOpen = await isPortOpen(hostname, port);
      
      if (!portOpen) {
        // If port is closed and it was discovered in a project config, report it as offline.
        // Otherwise, skip standard fallbacks that are not listening on the system to avoid cluttering the UI.
        if (!isFallback) {
          detectedDatabases.push({
            type,
            name: database,
            host,
            user,
            sourceProcess: source,
            status: "offline",
            sizeBytes: 0,
            maskedUri,
            error: `Connection refused: database server is not running on port ${port}`
          });
        }
        continue;
      }

      // Port is open! Database service is running on the system.
      try {
        if (type === "postgres") {
          const dbStatsList = await getPostgresStats(uri);
          dbStatsList.forEach((stats) => {
            detectedDatabases.push({
              type,
              name: stats.name || database,
              host,
              user,
              sourceProcess: source,
              status: "online",
              sizeBytes: stats.sizeBytes || 0,
              connectionCount: stats.connectionCount,
              tablesCount: stats.tablesCount,
              maskedUri,
            });
          });
        } else if (type === "mongodb") {
          const dbStatsList = await getMongoStats(uri);
          dbStatsList.forEach((stats) => {
            detectedDatabases.push({
              type,
              name: stats.name || database,
              host,
              user,
              sourceProcess: source,
              status: "online",
              sizeBytes: stats.sizeBytes || 0,
              collectionsCount: stats.collectionsCount,
              documentsCount: stats.documentsCount,
              maskedUri,
            });
          });
        }
      } catch (clientError) {
        // TCP port is open, but connection handshake or authorization failed.
        // Report as online since the database process is running, but display auth details / error.
        detectedDatabases.push({
          type,
          name: database,
          host,
          user,
          sourceProcess: source,
          status: "online",
          sizeBytes: 0,
          maskedUri,
          error: clientError instanceof Error ? clientError.message : String(clientError),
        });
      }
    } catch (parseError) {
      console.error("Failed to process database scan target:", uri, parseError);
    }
  }

  return detectedDatabases;
}
