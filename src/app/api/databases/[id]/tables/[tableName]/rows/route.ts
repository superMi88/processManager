import { NextResponse } from "next/server";
import { updateRow, deleteRow } from "@/lib/db-browser";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; tableName: string }> }
) {
  const { id, tableName } = await context.params;
  try {
    const body = await request.json();
    const { primaryKey, updatedData } = body || {};

    if (!primaryKey || typeof primaryKey !== "object") {
      return NextResponse.json(
        { error: "primaryKey muss angegeben werden." },
        { status: 400 }
      );
    }
    if (!updatedData || typeof updatedData !== "object") {
      return NextResponse.json(
        { error: "updatedData muss angegeben werden." },
        { status: 400 }
      );
    }

    await updateRow(id, tableName, primaryKey, updatedData);
    return NextResponse.json({ success: true, message: "Zeile erfolgreich aktualisiert." });
  } catch (error) {
    console.error(`Failed to update row in table '${tableName}':`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errMsg || "Fehler beim Aktualisieren der Zeile." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; tableName: string }> }
) {
  const { id, tableName } = await context.params;
  try {
    const body = await request.json();
    const { primaryKey } = body || {};

    if (!primaryKey || typeof primaryKey !== "object") {
      return NextResponse.json(
        { error: "primaryKey muss angegeben werden." },
        { status: 400 }
      );
    }

    await deleteRow(id, tableName, primaryKey);
    return NextResponse.json({ success: true, message: "Zeile erfolgreich gelöscht." });
  } catch (error) {
    console.error(`Failed to delete row from table '${tableName}':`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errMsg || "Fehler beim Löschen der Zeile." },
      { status: 500 }
    );
  }
}
