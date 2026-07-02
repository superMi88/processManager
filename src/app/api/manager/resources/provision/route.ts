import { NextResponse } from "next/server";
import { Client } from "pg";
import { readStore, writeStore, DatabaseConfig } from "@/lib/resource-store";

// Helper to validate database identifiers against SQL injection / command injection
function isValidIdentifier(id: string): boolean {
  return /^[a-zA-Z0-9_\-]+$/.test(id);
}

export async function POST(request: Request) {
  try {
    const { adminConnection, newDatabase } = await request.json();

    if (!adminConnection || !newDatabase) {
      return NextResponse.json({ error: "Fehlende Verbindungsinformationen." }, { status: 400 });
    }

    const { type, host, port, user: adminUser, password: adminPassword, database: adminDb } = adminConnection;
    const { alias, database: newDb, user: newUser, password: newPassword, schema: newSchema } = newDatabase;

    // Validate inputs
    if (!type || !host || !port || !newDb || !newUser || !newPassword) {
      return NextResponse.json({ error: "Unvollständige Formulardaten." }, { status: 400 });
    }

    if (type !== "postgres" && type !== "mongodb") {
      return NextResponse.json({ error: "Ungültiger Datenbanktyp. Erlaubt sind postgres oder mongodb." }, { status: 400 });
    }

    // Validate identifiers to prevent SQL / command injection
    if (!isValidIdentifier(newDb)) {
      return NextResponse.json({ error: "Ungültiger Datenbankname. Nur Alphanumerisch, Unterstriche und Bindestriche erlaubt." }, { status: 400 });
    }
    if (!isValidIdentifier(newUser)) {
      return NextResponse.json({ error: "Ungültiger Benutzername. Nur Alphanumerisch, Unterstriche und Bindestriche erlaubt." }, { status: 400 });
    }
    if (newSchema && !isValidIdentifier(newSchema)) {
      return NextResponse.json({ error: "Ungültiges Schema. Nur Alphanumerisch, Unterstriche und Bindestriche erlaubt." }, { status: 400 });
    }

    // Perform database provisioning
    if (type === "postgres") {
      const client = new Client({
        host,
        port: Number(port),
        user: adminUser || "postgres",
        password: typeof adminPassword === 'string' ? adminPassword : "",
        database: adminDb || "postgres",
        connectionTimeoutMillis: 5000,
      });

      await client.connect();

      try {
        const safeUser = newUser.replace(/"/g, '""');
        const safeDb = newDb.replace(/"/g, '""');

        // Check if user already exists
        const userCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [newUser]);
        const safePassword = newPassword.replace(/'/g, "''");
        if (userCheck.rows.length === 0) {
          // Create new user
          await client.query(`CREATE USER "${safeUser}" WITH PASSWORD '${safePassword}'`);
        } else {
          // Update password
          await client.query(`ALTER USER "${safeUser}" WITH PASSWORD '${safePassword}'`);
        }

        // Check if database already exists
        const dbCheck = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [newDb]);
        if (dbCheck.rows.length === 0) {
          // Create database
          await client.query(`CREATE DATABASE "${safeDb}" OWNER "${safeUser}"`);
          // Grant privileges
          await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${safeDb}" TO "${safeUser}"`);
        } else {
          // Update owner
          await client.query(`ALTER DATABASE "${safeDb}" OWNER TO "${safeUser}"`);
        }
      } finally {
        await client.end();
      }

      // If a schema is specified and it is not the default public schema, we must connect to the newly created DB and create the schema
      if (newSchema && newSchema !== "public") {
        const schemaClient = new Client({
          host,
          port: Number(port),
          user: adminUser || "postgres",
          password: typeof adminPassword === 'string' ? adminPassword : "",
          database: newDb, // connect directly to the newly created DB
          connectionTimeoutMillis: 5000,
        });

        await schemaClient.connect();
        try {
          const safeSchema = newSchema.replace(/"/g, '""');
          const safeUser = newUser.replace(/"/g, '""');
          await schemaClient.query(`CREATE SCHEMA IF NOT EXISTS "${safeSchema}" AUTHORIZATION "${safeUser}"`);
        } finally {
          await schemaClient.end();
        }
      }

    } else if (type === "mongodb") {
      const { MongoClient } = await import("mongodb");
      const authPart = adminUser ? `${encodeURIComponent(adminUser)}:${encodeURIComponent(adminPassword)}@` : "";
      const url = `mongodb://${authPart}${host}:${port}/${adminDb || "admin"}`;
      const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });

      await client.connect();
      try {
        const targetDb = client.db(newDb);
        // Check if user already exists
        const userInfo = await targetDb.command({ usersInfo: newUser });
        if (userInfo.users.length === 0) {
          await targetDb.command({
            createUser: newUser,
            pwd: newPassword,
            roles: [{ role: "dbOwner", db: newDb }]
          });
        } else {
          await targetDb.command({
            updateUser: newUser,
            pwd: newPassword,
            roles: [{ role: "dbOwner", db: newDb }]
          });
        }
      } finally {
        await client.close();
      }
    }

    // Provision successful! Now register the database in resources.json
    const store = readStore();
    const newDbConfig: DatabaseConfig = {
      id: `db-${Date.now()}`,
      alias: alias || `${newDb} (${type === "postgres" ? "PostgreSQL" : "MongoDB"})`,
      type,
      host,
      port: Number(port),
      database: newDb,
      schema: type === "postgres" ? (newSchema || "public") : undefined,
      users: [
        {
          id: "u-default",
          username: newUser,
          password: newPassword,
          alias: "Anwendungs-Benutzer"
        }
      ],
      superuser: type === "postgres" ? {
        id: "u-migration",
        username: adminUser || "postgres",
        password: adminPassword || "",
        alias: "Migrations-Benutzer"
      } : undefined
    };

    store.databases.push(newDbConfig);
    const success = writeStore(store);
    if (!success) {
      return NextResponse.json({ error: "Datenbank wurde erstellt, konnte aber nicht in der Konfiguration gespeichert werden." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Datenbank '${newDb}' wurde erfolgreich erstellt und registriert.`,
      databases: store.databases,
      credentials: store.credentials
    });

  } catch (error) {
    console.error("POST /api/manager/resources/provision failed:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
