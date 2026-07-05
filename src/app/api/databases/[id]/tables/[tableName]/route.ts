import { NextResponse } from "next/server";
import { getColumns, queryRows } from "@/lib/db-browser";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; tableName: string }> }
) {
  const { id, tableName } = await context.params;
  try {
    const columns = await getColumns(id, tableName);
    return NextResponse.json({ success: true, columns });
  } catch (error: any) {
    console.error(`Failed to get columns for table '${tableName}':`, error);
    return NextResponse.json(
      { error: error?.message || "Fehler beim Laden der Spalten-Metadaten." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; tableName: string }> }
) {
  const { id, tableName } = await context.params;
  try {
    const body = await request.json();
    const { filters, sortColumn, sortDirection, limit, offset } = body || {};

    const result = await queryRows(id, tableName, {
      filters,
      sortColumn,
      sortDirection,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error(`Failed to query rows for table '${tableName}':`, error);
    return NextResponse.json(
      { error: error?.message || "Fehler beim Abfragen der Tabellendaten." },
      { status: 500 }
    );
  }
}
