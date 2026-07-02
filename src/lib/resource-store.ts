import fs from "fs";
import path from "path";
import { restartProcess } from "./pm2";

export interface DatabaseUser {
  id: string;
  username: string;
  password?: string;
  alias?: string;
}

export interface DatabaseConfig {
  id: string;
  alias: string;
  type: "postgres" | "mongodb";
  host: string;
  port: number;
  database: string;
  schema?: string;
  users: DatabaseUser[];
  superuser?: DatabaseUser;
}

export interface CredentialConfig {
  id: string;
  alias: string;
  key: string;
  value: string;
  type?: "google" | "port";
}

export interface ProjectRequirement {
  key: string;
  type: "database" | "credential";
  dbType?: "postgres" | "mongodb";
  description?: string;
}

export interface ProjectDeclaration {
  name: string;
  requirements: ProjectRequirement[];
}

export interface ResourceStore {
  databases: DatabaseConfig[];
  credentials: CredentialConfig[];
  links: Record<string, Record<string, string>>; // projectName -> envKey -> resourceId
}

const STORE_PATH = path.resolve(process.cwd(), "src/data/resources.json");

// Helper to load store
export function readStore(): ResourceStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const content = fs.readFileSync(STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      
      // Auto-migrate databases to support users array and superuser field
      if (store.databases && Array.isArray(store.databases)) {
        let migrated = false;
        store.databases = store.databases.map((db: DatabaseConfig & { user?: string; password?: string }) => {
          if (!db.users || !Array.isArray(db.users)) {
            db.users = [
              {
                id: "u-default",
                username: db.user || "postgres",
                password: db.password || "",
                alias: "Standard-Benutzer"
              }
            ];
            delete db.user;
            delete db.password;
            migrated = true;
          }
          
          // Migrate any existing u-migration user from users list to the superuser field
          const migUserIdx = db.users.findIndex(u => u.id === "u-migration");
          if (migUserIdx !== -1) {
            db.superuser = db.users[migUserIdx];
            db.users = db.users.filter(u => u.id !== "u-migration");
            migrated = true;
          }
          
          return db;
        });
        if (migrated) {
          fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
        }
      }
      return store;
    }
  } catch (error) {
    console.error("Failed to read resources store:", error);
  }
  return { databases: [], credentials: [], links: {} };
}

// Helper to save store
export function writeStore(store: ResourceStore): boolean {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to write resources store:", error);
    return false;
  }
}

// Scan sibling folders for process-manager.json
export function getDiscoveredProjects(): { 
  projectPath: string; 
  declaration: ProjectDeclaration; 
  hasPrisma: boolean; 
  hasMigrations: boolean; 
}[] {
  const discovered: { 
    projectPath: string; 
    declaration: ProjectDeclaration; 
    hasPrisma: boolean; 
    hasMigrations: boolean; 
  }[] = [];
  const parentDir = path.resolve(process.cwd(), "..");
  
  try {
    if (fs.existsSync(parentDir)) {
      const dirs = fs.readdirSync(parentDir);
      for (const dir of dirs) {
        const projectPath = path.join(parentDir, dir);
        try {
          const stat = fs.statSync(projectPath);
          if (stat.isDirectory()) {
            const reqPath = path.join(projectPath, "process-manager.json");
            if (fs.existsSync(reqPath)) {
              const content = fs.readFileSync(reqPath, "utf-8");
              const declaration = JSON.parse(content) as ProjectDeclaration;
              if (declaration && declaration.name) {
                // Check if project uses Prisma
                const prismaSchemaPath = path.join(projectPath, "prisma", "schema.prisma");
                const migrationsPath = path.join(projectPath, "prisma", "migrations");
                const hasPrisma = fs.existsSync(prismaSchemaPath);
                let hasMigrations = false;

                if (hasPrisma && fs.existsSync(migrationsPath)) {
                  try {
                    const migrationDirs = fs.readdirSync(migrationsPath);
                    hasMigrations = migrationDirs.some(file => {
                      const fullPath = path.join(migrationsPath, file);
                      return fs.statSync(fullPath).isDirectory();
                    });
                  } catch {
                    hasMigrations = false;
                  }
                }

                discovered.push({ 
                  projectPath, 
                  declaration, 
                  hasPrisma, 
                  hasMigrations 
                });
              }
            }
          }
        } catch {
          // Ignore directory scan errors
        }
      }
    }
  } catch (error) {
    console.error("Failed to scan sibling projects:", error);
  }
  
  return discovered;
}

// Build connection URL for database
export function buildDatabaseUrl(db: DatabaseConfig, userObj?: DatabaseUser): string {
  const user = userObj || db.users?.[0];
  const userPass = user ? `${user.username}:${user.password || ""}@` : "";
  if (db.type === "postgres") {
    const schema = db.schema ? `?schema=${db.schema}` : "";
    return `postgresql://${userPass}${db.host}:${db.port}/${db.database}${schema}`;
  } else if (db.type === "mongodb") {
    // MongoDB doesn't enforce schema, check if srv or standard
    return `mongodb://${userPass}${db.host}:${db.port}/${db.database}`;
  }
  return "";
}

// Generate env variables content for a project
export function generateEnvContent(projectName: string, declaration: ProjectDeclaration, store: ResourceStore): string {
  const projectLinks = store.links[projectName] || {};
  const envLines = [
    `# ===================================================`,
    `# GENERATED BY PROCESS MANAGER - DO NOT EDIT MANUALLY`,
    `# Generated at: ${new Date().toISOString()}`,
    `# ===================================================`,
    ""
  ];

  for (const req of declaration.requirements) {
    const resourceId = projectLinks[req.key];
    let value = "";
    
    if (resourceId) {
      if (req.type === "database") {
        const db = store.databases.find(d => d.id === resourceId);
        if (db) {
          const selectedUserId = projectLinks[`${req.key}_USER`];
          const userObj = db.users?.find(u => u.id === selectedUserId) || db.users?.[0];
          value = buildDatabaseUrl(db, userObj);
        }
      } else {
        const cred = store.credentials.find(c => c.id === resourceId);
        if (cred) {
          value = cred.value;
        }
      }
    }
    
    envLines.push(`# ${req.description || req.key}`);
    // If value contains spaces, wrap in quotes
    const formattedValue = value.includes(" ") ? `"${value}"` : value;
    envLines.push(`${req.key}=${formattedValue}`);
    envLines.push("");
  }
  
  return envLines.join("\n");
}

// Apply project environment and optionally restart via PM2
export async function applyProjectEnvironment(projectName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const store = readStore();
    const discovered = getDiscoveredProjects();
    const projInfo = discovered.find(p => p.declaration.name === projectName);
    
    if (!projInfo) {
      return { success: false, error: `Project '${projectName}' not found. Make sure it has a process-manager.json file.` };
    }
    
    const envContent = generateEnvContent(projectName, projInfo.declaration, store);
    const envPath = path.join(projInfo.projectPath, ".env");
    
    // Write the .env file
    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log(`Successfully wrote .env for ${projectName} at ${envPath}`);
    
    // Attempt restart of the process with PM2 in the background so it does not block the API response
    // We assume the PM2 process name matches the project name (e.g. "kiSystem") or lowercase project name
    setTimeout(async () => {
      try {
        const pm2Names = [projectName, projectName.toLowerCase(), `${projectName}-server`];
        let restarted = false;
        for (const name of pm2Names) {
          const success = await restartProcess(name);
          if (success) {
            restarted = true;
            break;
          }
        }
        
        if (!restarted) {
          console.warn(`PM2 process for project '${projectName}' not found or could not be restarted. The .env file was still updated.`);
        }
      } catch (pm2Error) {
        console.error(`Failed to restart PM2 process for project '${projectName}':`, pm2Error);
      }
    }, 50);
    
    return { success: true };
  } catch (error) {
    console.error(`Failed to apply project environment for ${projectName}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
