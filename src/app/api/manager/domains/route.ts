import { NextResponse } from "next/server";
import { readStore, writeStore, getDiscoveredProjects } from "@/lib/resource-store";
import { 
  resolveNginxConfigDir, 
  writeDomainConfig, 
  deleteDomainConfig, 
  reloadNginx, 
  runCertbot 
} from "@/lib/nginx";

export const dynamic = "force-dynamic";

/**
 * Resolves the port number associated with a project name.
 */
function resolveProjectPort(projectName: string, store: ReturnType<typeof readStore>): number | null {
  const projectLinks = store.links[projectName] || {};
  const discovered = getDiscoveredProjects();
  const proj = discovered.find(p => p.declaration.name === projectName);
  if (!proj) return null;
  
  // 1. Check mapped credentials to find one with value parsed as port number
  for (const req of proj.declaration.requirements) {
    if (req.type === "credential") {
      const resourceId = projectLinks[req.key];
      if (resourceId) {
        const cred = store.credentials.find(c => c.id === resourceId);
        if (cred) {
          // If explicitly marked as port, or named PORT, or is a valid number
          const isPortCred = cred.type === "port" || cred.key === "PORT" || cred.key.includes("PORT");
          const parsed = parseInt(cred.value, 10);
          if (isPortCred && !isNaN(parsed) && parsed > 0) {
            return parsed;
          }
        }
      }
    }
  }

  // 2. Fallback check: check any mapped credential that is a number
  for (const req of proj.declaration.requirements) {
    if (req.type === "credential") {
      const resourceId = projectLinks[req.key];
      if (resourceId) {
        const cred = store.credentials.find(c => c.id === resourceId);
        if (cred) {
          const parsed = parseInt(cred.value, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
            return parsed;
          }
        }
      }
    }
  }

  return null;
}

export async function GET() {
  try {
    const store = readStore();
    const configDir = resolveNginxConfigDir();
    const reloadCmd = process.env.NGINX_RELOAD_COMMAND || "nginx -s reload";

    return NextResponse.json({
      domains: store.domains || [],
      configDir: configDir || "Keines (wird nichts geschrieben)",
      reloadCommand: reloadCmd
    });
  } catch (error) {
    console.error("GET /api/manager/domains failed:", error);
    return NextResponse.json({ error: "Failed to load domains" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, domain, targetType, targetValue, sslEnabled } = body;
    const store = readStore();

    // Support manual reload trigger
    if (action === "reload") {
      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        return NextResponse.json({ 
          success: false, 
          error: reloadResult.error || "Nginx-Reload schlug fehl." 
        });
      }
      return NextResponse.json({ success: true });
    }

    // Standard domain registration validation
    if (!domain || !targetType || !targetValue) {
      return NextResponse.json({ error: "Fehlende Pflichtangaben (domain, targetType, targetValue)" }, { status: 400 });
    }

    // Check duplicate domain
    const domains = store.domains || [];
    if (domains.some(d => d.domain.toLowerCase() === domain.toLowerCase())) {
      return NextResponse.json({ error: "Diese Domain ist bereits registriert." }, { status: 400 });
    }

    // Resolve target port
    let port: number | null = null;
    if (targetType === "port") {
      port = parseInt(targetValue, 10);
      if (isNaN(port) || port <= 0 || port >= 65536) {
        return NextResponse.json({ error: "Ungültige Portnummer." }, { status: 400 });
      }
    } else if (targetType === "project") {
      port = resolveProjectPort(targetValue, store);
      if (!port) {
        return NextResponse.json({ 
          error: `Der Port für das Projekt '${targetValue}' konnte nicht ermittelt werden. Bitte stellen Sie sicher, dass ein gültiger Port in den Projekt-Keys verlinkt ist.` 
        }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Ungültiger Zieltyp." }, { status: 400 });
    }

    // Write Nginx config
    const writeResult = await writeDomainConfig(domain, port);
    if (!writeResult.success) {
      return NextResponse.json({ error: writeResult.error || "Schreiben der Konfigurationsdatei schlug fehl." }, { status: 500 });
    }

    // Reload Nginx config
    let warning = writeResult.warning || "";
    const configDir = resolveNginxConfigDir();
    
    if (configDir) {
      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        warning += (warning ? " " : "") + `Nginx konnte nicht neu geladen werden: ${reloadResult.error}. Bitte laden Sie Nginx manuell neu.`;
      }
    }

    // Run Certbot for SSL if requested and Nginx dir exists
    let sslApplied = false;
    if (sslEnabled && configDir) {
      const certbotResult = await runCertbot(domain);
      if (!certbotResult.success) {
        warning += (warning ? " " : "") + `Certbot SSL-Registrierung fehlgeschlagen: ${certbotResult.error}`;
      } else {
        sslApplied = true;
      }
    }

    // Save to store
    const newDomain = {
      id: `dom-${Date.now()}`,
      domain,
      targetType,
      targetValue,
      sslEnabled: sslApplied,
      createdAt: new Date().toISOString()
    };

    store.domains = [...(store.domains || []), newDomain];
    writeStore(store);

    return NextResponse.json({ 
      success: true, 
      domain: newDomain,
      warning: warning || undefined
    });
  } catch (error) {
    console.error("POST /api/manager/domains failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing domain ID" }, { status: 400 });
    }

    const store = readStore();
    const domainObj = (store.domains || []).find(d => d.id === id);

    if (!domainObj) {
      return NextResponse.json({ error: "Domain nicht gefunden" }, { status: 404 });
    }

    // Delete Nginx config file
    const delResult = await deleteDomainConfig(domainObj.domain);
    
    // Reload Nginx
    let warning = delResult.warning || "";
    const configDir = resolveNginxConfigDir();
    if (configDir) {
      const reloadResult = await reloadNginx();
      if (!reloadResult.success) {
        warning += (warning ? " " : "") + `Nginx-Reload fehlgeschlagen: ${reloadResult.error}`;
      }
    }

    // Remove from store
    store.domains = (store.domains || []).filter(d => d.id !== id);
    writeStore(store);

    return NextResponse.json({ 
      success: true,
      warning: warning || undefined
    });
  } catch (error) {
    console.error("DELETE /api/manager/domains failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
