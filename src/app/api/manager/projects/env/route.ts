import { NextResponse } from "next/server";
import { getProjectEnvFile, saveProjectEnvFile } from "@/lib/resource-store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get("project");
    const service = searchParams.get("service") || undefined;

    if (!project) {
      return NextResponse.json({ error: "Missing 'project' parameter" }, { status: 400 });
    }

    const result = getProjectEnvFile(project, service);
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to read .env file" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/manager/projects/env error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project, service, content, restart } = body;

    if (!project) {
      return NextResponse.json({ error: "Missing 'project' in request body" }, { status: 400 });
    }

    if (typeof content !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'content' string" }, { status: 400 });
    }

    const result = await saveProjectEnvFile(project, service || undefined, content, restart !== false);
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to save .env file" }, { status: 500 });
    }

    return NextResponse.json({ success: true, restarted: result.restarted });
  } catch (error) {
    console.error("POST /api/manager/projects/env error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
