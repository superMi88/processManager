import { NextResponse } from "next/server";
import { scanDatabases } from "@/lib/db-scanner";

export async function GET() {
  try {
    const databases = await scanDatabases();
    return NextResponse.json(databases);
  } catch (error) {
    console.error("Failed to scan databases:", error);
    return NextResponse.json(
      { error: "Failed to scan server databases" },
      { status: 500 }
    );
  }
}
