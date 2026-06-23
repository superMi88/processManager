import { NextResponse } from "next/server";
import { startProcess, stopProcess, restartProcess, getProcessLogs } from "@/lib/pm2";

export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await context.params;
    const { searchParams } = new URL(request.url);
    const linesParam = searchParams.get("lines");
    const maxLines = linesParam ? parseInt(linesParam, 10) : 100;

    const logs = await getProcessLogs(name, maxLines);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error(`Failed to get logs for process:`, error);
    return NextResponse.json(
      { error: "Failed to read process logs" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await context.params;
    const { action } = await request.json();

    if (!action || !["start", "stop", "restart"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'start', 'stop', or 'restart'." },
        { status: 400 }
      );
    }

    let success = false;
    switch (action) {
      case "start":
        success = await startProcess(name);
        break;
      case "stop":
        success = await stopProcess(name);
        break;
      case "restart":
        success = await restartProcess(name);
        break;
    }

    if (!success) {
      return NextResponse.json(
        { error: `Failed to perform action '${action}' on process '${name}'` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Error performing action on process:`, error);
    return NextResponse.json(
      { error: "Failed to execute process operation" },
      { status: 500 }
    );
  }
}
