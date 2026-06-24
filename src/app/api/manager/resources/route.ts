import { NextResponse } from "next/server";
import { readStore, writeStore, DatabaseConfig, CredentialConfig } from "@/lib/resource-store";

export async function GET() {
  try {
    const store = readStore();
    return NextResponse.json({
      databases: store.databases,
      credentials: store.credentials
    });
  } catch (error) {
    console.error("GET /api/manager/resources failed:", error);
    return NextResponse.json({ error: "Failed to load resources" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, type, data } = await request.json();
    const store = readStore();
    
    if (action === "save") {
      if (type === "database") {
        const db = data as DatabaseConfig;
        if (!db.id) {
          db.id = `db-${Date.now()}`;
          store.databases.push(db);
        } else {
          const idx = store.databases.findIndex(d => d.id === db.id);
          if (idx !== -1) {
            store.databases[idx] = db;
          } else {
            store.databases.push(db);
          }
        }
      } else if (type === "credential") {
        const cred = data as CredentialConfig;
        if (!cred.id) {
          cred.id = `cred-${Date.now()}`;
          store.credentials.push(cred);
        } else {
          const idx = store.credentials.findIndex(c => c.id === cred.id);
          if (idx !== -1) {
            store.credentials[idx] = cred;
          } else {
            store.credentials.push(cred);
          }
        }
      } else {
        return NextResponse.json({ error: "Invalid resource type" }, { status: 400 });
      }
    } else if (action === "delete") {
      const { id } = data;
      if (!id) {
        return NextResponse.json({ error: "Missing resource ID" }, { status: 400 });
      }
      
      if (type === "database") {
        store.databases = store.databases.filter(d => d.id !== id);
      } else if (type === "credential") {
        store.credentials = store.credentials.filter(c => c.id !== id);
      } else {
        return NextResponse.json({ error: "Invalid resource type" }, { status: 400 });
      }
      
      // Clean up links referencing deleted resource
      for (const projName of Object.keys(store.links)) {
        const projLinks = store.links[projName];
        for (const envKey of Object.keys(projLinks)) {
          if (projLinks[envKey] === id) {
            delete projLinks[envKey];
          }
        }
      }
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    
    const success = writeStore(store);
    if (!success) {
      return NextResponse.json({ error: "Failed to write resources to storage" }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, databases: store.databases, credentials: store.credentials });
  } catch (error) {
    console.error("POST /api/manager/resources failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
