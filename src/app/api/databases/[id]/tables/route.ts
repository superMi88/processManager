import { NextResponse } from "next/server";
import { getTables } from "@/lib/db-browser";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const tables = await getTables(id);
    return NextResponse.json({ success: true, tables });
  } catch (error) {
    console.error(`Failed to get tables for database:`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errMsg || "Fehler beim Laden der Tabellen." },
      { status: 500 }
    );
  }
}
