import { NextResponse } from "next/server";
import { changeTableOwner } from "@/lib/db-browser";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; tableName: string }> }
) {
  const { id, tableName } = await context.params;
  try {
    const body = await request.json();
    const { newOwner } = body || {};

    if (!newOwner || typeof newOwner !== "string") {
      return NextResponse.json(
        { error: "Neuer Besitzer (newOwner) muss angegeben werden." },
        { status: 400 }
      );
    }

    await changeTableOwner(id, tableName, newOwner.trim());
    return NextResponse.json({
      success: true,
      message: `Besitzer von Tabelle '${tableName}' erfolgreich auf '${newOwner}' geändert.`,
    });
  } catch (error) {
    console.error(`Failed to change owner for table '${tableName}':`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errMsg || "Fehler beim Ändern des Tabellenbesitzers." },
      { status: 500 }
    );
  }
}
