import { NextResponse } from "next/server";
import { 
  readStore, 
  writeStore, 
  getDiscoveredProjects, 
  applyProjectEnvironment 
} from "@/lib/resource-store";

export async function GET() {
  try {
    const store = readStore();
    const discovered = getDiscoveredProjects();
    
    // Map discovered projects to include their current mapping from the store
    const projects = discovered.map(p => {
      const name = p.declaration.name;
      return {
        name,
        path: p.projectPath,
        requirements: p.declaration.requirements,
        links: store.links[name] || {},
        hasPrisma: p.hasPrisma,
        hasMigrations: p.hasMigrations
      };
    });
    
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("GET /api/manager/projects failed:", error);
    return NextResponse.json({ error: "Failed to scan projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, projectName, links } = await request.json();
    const store = readStore();
    
    if (!projectName) {
      return NextResponse.json({ error: "Missing projectName" }, { status: 400 });
    }
    
    if (action === "link" || action === "apply") {
      if (links) {
        store.links[projectName] = links;
        const success = writeStore(store);
        if (!success) {
          return NextResponse.json({ error: "Failed to save links to store" }, { status: 500 });
        }
      }
      
      if (action === "apply") {
        const result = await applyProjectEnvironment(projectName);
        if (!result.success) {
          return NextResponse.json({ error: result.error || "Failed to apply environment variables" }, { status: 500 });
        }
        return NextResponse.json({ success: true, message: `Environment variables successfully applied to '${projectName}'.` });
      }
      
      return NextResponse.json({ success: true, links: store.links[projectName] });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("POST /api/manager/projects failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
