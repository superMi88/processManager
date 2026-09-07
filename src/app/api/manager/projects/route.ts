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
      const servicesWithLinks = p.declaration.services.map(s => {
        const serviceKey = `${name}/${s.name}`;
        const serviceLinks = store.links[serviceKey] 
          || store.links[s.name] 
          || (p.declaration.services.length === 1 ? store.links[name] : {})
          || {};
        return {
          ...s,
          links: serviceLinks
        };
      });

      return {
        name,
        path: p.projectPath,
        repository: p.declaration.repository,
        services: servicesWithLinks,
        requirements: p.declaration.requirements || [],
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
    const { action, projectName, serviceName, links } = await request.json();
    const store = readStore();
    
    if (!projectName) {
      return NextResponse.json({ error: "Missing projectName" }, { status: 400 });
    }
    
    if (action === "link" || action === "apply") {
      const targetKey = serviceName ? `${projectName}/${serviceName}` : projectName;
      if (links) {
        store.links[targetKey] = links;
        // If there's no serviceName, also set store.links[projectName]
        if (!serviceName) {
          store.links[projectName] = links;
        }
        const success = writeStore(store);
        if (!success) {
          return NextResponse.json({ error: "Failed to save links to store" }, { status: 500 });
        }
      }
      
      if (action === "apply") {
        const result = await applyProjectEnvironment(projectName, serviceName);
        if (!result.success) {
          return NextResponse.json({ error: result.error || "Failed to apply environment variables" }, { status: 500 });
        }
        return NextResponse.json({ 
          success: true, 
          message: `Environment variables successfully applied to '${projectName}'${serviceName ? ` (${serviceName})` : ""}.` 
        });
      }
      
      return NextResponse.json({ success: true, links: store.links[targetKey] });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("POST /api/manager/projects failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
