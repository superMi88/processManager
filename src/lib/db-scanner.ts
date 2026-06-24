// Shim process.getBuiltinModule for older Node versions (like v20.15.0) which bson/mongodb uses
if (typeof process !== "undefined" && !process.getBuiltinModule) {
  // @ts-expect-error: getBuiltinModule is missing in Node v20.15.0 but called by bson
  process.getBuiltinModule = () => ({});
}

import pm2 from "pm2";
import { Client } from "pg";



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

// Mock databases for development mode
const mockDatabases: DatabaseInfo[] = [
  {
    type: "postgres",
    name: "kisystem",
    host: "localhost:5432",
    user: "ki_admin",
    sourceProcess: "kisystem",
    status: "online",
    sizeBytes: 48.2 * 1024 * 1024,
    connectionCount: 5,
    tablesCount: 14,
    maskedUri: "postgresql://ki_admin:*****@localhost:5432/kisystem?schema=public",
  },
  {
    type: "mongodb",
    name: "discord-logs",
    host: "localhost:27017",
    user: "db_user",
    sourceProcess: "discordBot",
    status: "online",
    sizeBytes: 124.5 * 1024 * 1024,
    collectionsCount: 8,
    documentsCount: 142500,
    maskedUri: "mongodb://db_user:*****@localhost:27017/discord-logs",
  },
  {
    type: "postgres",
    name: "auth-db",
    host: "localhost:5432",
    user: "api_user",
    sourceProcess: "api-server",
    status: "offline",
    sizeBytes: 0,
    maskedUri: "postgresql://api_user:*****@localhost:5432/auth-db",
    error: "Connection refused: no process listening on port 5432",
  },
];

// Helper to mask credentials
function maskConnectionString(uri: string): { host: string; database: string; user: string; maskedUri: string } {
  try {
    // Basic cleanup for parsing: replace postgresql:// or mongodb:// with standard https:// so URL parser works cleanly for all
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
  } catch (e) {
    console.error("Failed to parse URI:", uri, e);
    return { host: "unknown", database: "unknown", user: "unknown", maskedUri: "invalid-uri" };
  }
}

// Check if PM2 is available, otherwise return mock
function listPm2ProcessesRaw(): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.connect(true, (connectErr) => {
      if (connectErr) {
        return reject(connectErr);
      }
      pm2.list((listErr, list) => {
        pm2.disconnect();
        if (listErr) {
          return reject(listErr);
        }
        resolve(list);
      });
    });
  });
}

async function getPostgresStats(connectionString: string) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    
    const sizeRes = await client.query("SELECT pg_database_size(current_database()) as size_bytes");
    const sizeBytes = parseInt(sizeRes.rows[0]?.size_bytes || "0", 10);
    
    const tablesRes = await client.query(
      "SELECT count(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tablesCount = parseInt(tablesRes.rows[0]?.count || "0", 10);
    
    const connRes = await client.query(
      "SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()"
    );
    const connectionsCount = parseInt(connRes.rows[0]?.count || "0", 10);
    
    await client.end();
    
    return {
      status: "online" as const,
      sizeBytes,
      tablesCount,
      connectionsCount,
    };
  } catch (error) {
    try {
      await client.end();
    } catch {}
    return {
      status: "offline" as const,
      error: error instanceof Error ? error.message : String(error),
      sizeBytes: 0,
      tablesCount: 0,
      connectionsCount: 0,
    };
  }
}

async function getMongoStats(connectionString: string) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    
    // Parse DB name
    const cleanUri = connectionString.startsWith("mongodb+srv://")
      ? connectionString.replace("mongodb+srv://", "http://")
      : connectionString.replace("mongodb://", "http://");
    const parsed = new URL(cleanUri);
    const dbName = parsed.pathname.substring(1) || "test";
    
    const db = client.db(dbName);
    const stats = await db.command({ dbStats: 1 });
    
    const collectionsCount = stats.collections || 0;
    const documentsCount = stats.objects || 0;
    const sizeBytes = stats.dataSize || 0;
    
    await client.close();
    
    return {
      status: "online" as const,
      sizeBytes,
      collectionsCount,
      documentsCount,
    };
  } catch (error) {
    try {
      await client.close();
    } catch {}
    return {
      status: "offline" as const,
      error: error instanceof Error ? error.message : String(error),
      sizeBytes: 0,
      collectionsCount: 0,
      documentsCount: 0,
    };
  }
}

export async function scanDatabases(): Promise<DatabaseInfo[]> {
  let pm2Processes: pm2.ProcessDescription[] = [];
  let isMockMode = false;

  try {
    pm2Processes = await listPm2ProcessesRaw();
  } catch (error) {
    console.warn("Could not retrieve PM2 processes for database scanning. Using mock databases.", error);
    isMockMode = true;
  }

  if (isMockMode || pm2Processes.length === 0) {
    // In mock mode, we simulate slight resource variations
    return mockDatabases.map((db) => {
      if (db.status === "online") {
        return {
          ...db,
          sizeBytes: db.sizeBytes + Math.round((Math.random() - 0.5) * 10000),
          connectionCount: db.connectionCount ? Math.max(1, db.connectionCount + Math.round((Math.random() - 0.5) * 2)) : undefined,
        };
      }
      return db;
    });
  }

  const detectedDatabases: DatabaseInfo[] = [];

  for (const proc of pm2Processes) {
    const envs = proc.pm2_env || {};
    const processName = proc.name || "unknown";
    
    // We look for common environment variable keys
    const connectionKeys = ["DATABASE_URL", "MONGODB_URI", "MONGO_URL", "MONGO_URI", "REDIS_URL", "MYSQL_URL"];
    
    for (const key of connectionKeys) {
      const uri = envs[key];
      if (uri && typeof uri === "string" && uri.includes("://")) {
        // Determine type
        let type: "postgres" | "mongodb" | "unknown" = "unknown";
        if (uri.startsWith("postgres://") || uri.startsWith("postgresql://")) {
          type = "postgres";
        } else if (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://")) {
          type = "mongodb";
        }

        if (type === "unknown") continue;

        // Check if we already processed this connection string (avoid duplicates)
        const isDuplicate = detectedDatabases.some(d => d.maskedUri === maskConnectionString(uri).maskedUri);
        if (isDuplicate) continue;

        const { host, database, user, maskedUri } = maskConnectionString(uri);

        let stats: {
          status: "online" | "offline";
          sizeBytes: number;
          error?: string;
          tablesCount?: number;
          connectionsCount?: number;
          collectionsCount?: number;
          documentsCount?: number;
        } = { status: "offline", sizeBytes: 0 };
        if (type === "postgres") {
          stats = await getPostgresStats(uri);
        } else if (type === "mongodb") {
          stats = await getMongoStats(uri);
        }

        detectedDatabases.push({
          type,
          name: database,
          host,
          user,
          sourceProcess: processName,
          status: stats.status,
          sizeBytes: stats.sizeBytes,
          connectionCount: stats.connectionsCount,
          tablesCount: stats.tablesCount,
          collectionsCount: stats.collectionsCount,
          documentsCount: stats.documentsCount,
          maskedUri,
          error: stats.error,
        });
      }
    }
  }

  return detectedDatabases;
}
