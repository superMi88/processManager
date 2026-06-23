import { NextResponse } from "next/server";
import { listProcesses } from "@/lib/pm2";

export async function GET() {
  try {
    const processes = await listProcesses();
    return NextResponse.json(processes);
  } catch (error) {
    console.error("Failed to list PM2 processes:", error);
    return NextResponse.json(
      { error: "Failed to fetch process list from PM2 daemon" },
      { status: 500 }
    );
  }
}
