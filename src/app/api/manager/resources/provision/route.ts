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

      // Connect directly to the target database as the admin/superuser to configure permissions and transfer ownership
      const targetDbClient = new Client({
        host,
        port: Number(port),
        user: adminUser || "postgres",
        password: typeof adminPassword === 'string' ? adminPassword : "",
        database: newDb,
        connectionTimeoutMillis: 5000,
      });

      await targetDbClient.connect();
      try {
        const targetSchema = newSchema || "public";
        const safeSchema = targetSchema.replace(/"/g, '""');
        const safeUser = newUser.replace(/"/g, '""');

        if (targetSchema !== "public") {
          await targetDbClient.query(`CREATE SCHEMA IF NOT EXISTS "${safeSchema}" AUTHORIZATION "${safeUser}"`);
        }

        // Grant full schema privileges to the app user (required especially for PG 15+)
        await targetDbClient.query(`GRANT ALL ON SCHEMA "${safeSchema}" TO "${safeUser}"`);
        await targetDbClient.query(`GRANT USAGE, CREATE ON SCHEMA "${safeSchema}" TO "${safeUser}"`);

        // If the database already existed and objects were created by the superuser or another role,
        // we transfer ownership of all existing tables, sequences, and views to the new owner.
        const sqlTransfer = `
          DO $$
          DECLARE
              r RECORD;
              target_user TEXT := $1;
              target_schema TEXT := $2;
          BEGIN
              -- Transfer tables
              FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = target_schema) LOOP
                  EXECUTE 'ALTER TABLE ' || quote_ident(target_schema) || '.' || quote_ident(r.tablename) || ' OWNER TO ' || quote_ident(target_user) || ';';
              END LOOP;
              
              -- Transfer sequences
              FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = target_schema) LOOP
                  EXECUTE 'ALTER SEQUENCE ' || quote_ident(target_schema) || '.' || quote_ident(r.sequence_name) || ' OWNER TO ' || quote_ident(target_user) || ';';
              END LOOP;

              -- Transfer views
              FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = target_schema) LOOP
                  EXECUTE 'ALTER VIEW ' || quote_ident(target_schema) || '.' || quote_ident(r.table_name) || ' OWNER TO ' || quote_ident(target_user) || ';';
              END LOOP;
          END $$;
        `;
        await targetDbClient.query(sqlTransfer, [newUser, targetSchema]);
      } finally {
        await targetDbClient.end();
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
