import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/resource-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = readStore();
    return NextResponse.json({
      processLinks: store.processLinks || {}
    });
  } catch (error) {
    console.error("GET /api/manager/process-links failed:", error);
    return NextResponse.json({ error: "Failed to read process links" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { processName, dbId, port, domain, dependsOn } = body;

    if (!processName || typeof processName !== "string") {
      return NextResponse.json({ error: "Missing or invalid processName" }, { status: 400 });
    }

    const store = readStore();
    if (!store.processLinks) {
      store.processLinks = {};
    }

    // Clean up empty values
    const cleanDbId = dbId ? String(dbId).trim() : undefined;
    const cleanPort = port ? String(port).trim() : undefined;
    const cleanDomain = domain ? String(domain).trim() : undefined;
    const cleanDependsOn = dependsOn ? String(dependsOn).trim() : undefined;

    if (!cleanDbId && !cleanPort && !cleanDomain && !cleanDependsOn) {
      delete store.processLinks[processName];
    } else {
      store.processLinks[processName] = {
        dbId: cleanDbId,
        port: cleanPort,
        domain: cleanDomain,
        dependsOn: cleanDependsOn
      };
    }

    const saved = writeStore(store);
    if (!saved) {
      return NextResponse.json({ error: "Failed to save process links" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      processLinks: store.processLinks
    });
  } catch (error) {
    console.error("POST /api/manager/process-links failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
