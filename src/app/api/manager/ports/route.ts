import { NextResponse } from "next/server";
import { readStore } from "@/lib/resource-store";
import { isPortOpen } from "@/lib/db-scanner";

export async function GET() {
  try {
    const store = readStore();
    
    // Define standard ports to scan
    const basePorts = [
      3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 
      3011, 3012, 3013, 3014, 3015, 4000, 5000, 8000, 8080, 9000
    ];
    
    const portsToScanSet = new Set<number>(basePorts);
    
    // Add any ports registered in the store
    store.credentials.forEach(cred => {
      const isPortCred = cred.type === "port" || cred.key === "PORT" || cred.key.includes("PORT");
      if (isPortCred) {
        const parsed = parseInt(cred.value, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
          portsToScanSet.add(parsed);
        }
      }
    });
    
    const portsToScan = Array.from(portsToScanSet).sort((a, b) => a - b);
    
    // Scan all ports in parallel
    const scanResults = await Promise.all(
      portsToScan.map(async (port) => {
        const inUse = await isPortOpen("127.0.0.1", port, 800);
        
        // Find matching registered port credential
        const matchingCred = store.credentials.find(cred => {
          const isPortCred = cred.type === "port" || cred.key === "PORT" || cred.key.includes("PORT");
          return isPortCred && parseInt(cred.value, 10) === port;
        });
        
        // Find if this credential is linked to any project
        let projectName: string | null = null;
        if (matchingCred) {
          for (const projName of Object.keys(store.links)) {
            const projLinks = store.links[projName];
            for (const envKey of Object.keys(projLinks)) {
              if (projLinks[envKey] === matchingCred.id) {
                projectName = projName;
                break;
              }
            }
            if (projectName) break;
          }
        }
        
        return {
          port,
          inUse,
          registered: !!matchingCred,
          alias: matchingCred?.alias || null,
          credentialId: matchingCred?.id || null,
          projectName
        };
      })
    );
    
    return NextResponse.json({ ports: scanResults });
  } catch (error) {
    console.error("GET /api/manager/ports failed:", error);
    return NextResponse.json({ error: "Failed to scan system ports" }, { status: 500 });
  }
}
