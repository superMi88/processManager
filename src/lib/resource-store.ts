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
  type: "database" | "credential" | "textinput" | "text" | "port" | "domain" | "secret";
  label?: string;
  defaultValue?: string;
  dbType?: "postgres" | "mongodb";
  description?: string;
}

export interface ProjectServiceDeclaration {
  name: string;
  envPath?: string; // e.g. ".env" or "./bot/.env"
  pm2Process?: string; // e.g. "kisystem", "discord-bot"
  domain?: string;
  requirements: ProjectRequirement[];
}

export interface ProjectDeclaration {
  name: string;
  repository?: string;
  services: ProjectServiceDeclaration[];
  requirements?: ProjectRequirement[];
  pm2Process?: string;
}

export interface DomainConfig {
  id: string;
  domain: string;
  targetType: "port" | "project";
  targetValue: string; // port number or project name
  sslEnabled?: boolean;
  createdAt: string;
}

export interface ProcessLinkConfig {
  dbId?: string;
  port?: string;
  domain?: string;
}

export interface ResourceStore {
  databases: DatabaseConfig[];
  credentials: CredentialConfig[];
  links: Record<string, Record<string, string>>; // projectName -> envKey -> resourceId
  domains?: DomainConfig[];
  processLinks?: Record<string, ProcessLinkConfig>; // processName -> { dbId, port, domain }
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
      if (!store.domains) {
        store.domains = [];
      }
      if (!store.processLinks) {
        store.processLinks = {};
      }
      return store;
    }
  } catch (error) {
    console.error("Failed to read resources store:", error);
  }
  return { databases: [], credentials: [], links: {}, domains: [], processLinks: {} };
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
                // Normalize services array
                if (!declaration.services || !Array.isArray(declaration.services)) {
                  declaration.services = [
                    {
                      name: declaration.name,
                      envPath: ".env",
                      pm2Process: declaration.pm2Process || declaration.name,
                      requirements: declaration.requirements || []
                    }
                  ];
                } else {
                  declaration.services = declaration.services.map(s => ({
                    name: s.name || declaration.name,
                    envPath: s.envPath || ".env",
                    pm2Process: s.pm2Process,
                    domain: s.domain,
                    requirements: Array.isArray(s.requirements) ? s.requirements : []
                  }));
                }
                if (!declaration.requirements) {
                  declaration.requirements = declaration.services.flatMap(s => s.requirements);
                }

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

// Generate env variables content for a project or service
export function generateEnvContent(
  targetKey: string, 
  serviceOrDeclaration: { requirements?: ProjectRequirement[]; name?: string }, 
  store: ResourceStore
): string {
  const projectLinks = store.links[targetKey] || {};
  const reqs = serviceOrDeclaration.requirements || [];
  const envLines = [
    `# ===================================================`,
    `# GENERATED BY PROCESS MANAGER - DO NOT EDIT MANUALLY`,
    serviceOrDeclaration.name ? `# Service / Project: ${serviceOrDeclaration.name}` : "",
    `# Generated at: ${new Date().toISOString()}`,
    `# ===================================================`,
    ""
  ].filter(Boolean);

  for (const req of reqs) {
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
      } else if (req.type === "textinput" || req.type === "text") {
        value = resourceId;
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

// Helper to restart a service PM2 process
export async function restartServiceProcess(projectName: string, service: ProjectServiceDeclaration): Promise<boolean> {
  let restarted = false;
  try {
    if (service.pm2Process) {
      restarted = await restartProcess(service.pm2Process);
    }
    if (!restarted) {
      const kebabCase = projectName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      const pm2Names = [
        service.name,
        service.name.toLowerCase(),
        projectName,
        projectName.toLowerCase(),
        `${projectName}-server`,
        kebabCase,
        `${kebabCase}-server`
      ];
      for (const name of pm2Names) {
        const success = await restartProcess(name);
        if (success) {
          restarted = true;
          break;
        }
      }
    }
  } catch (err) {
    console.error(`Failed to restart PM2 for service '${service.name}' of '${projectName}':`, err);
  }
  return restarted;
}

// Read or preview the .env file for a service
export function getProjectEnvFile(projectName: string, serviceName?: string): {
  success: boolean;
  content?: string;
  envPath?: string;
  envRelPath?: string;
  exists?: boolean;
  serviceName?: string;
  error?: string;
} {
  try {
    const store = readStore();
    const discovered = getDiscoveredProjects();
    const projInfo = discovered.find(p => p.declaration.name === projectName);
    if (!projInfo) {
      return { success: false, error: `Project '${projectName}' not found.` };
    }

    const service = serviceName 
      ? projInfo.declaration.services.find(s => s.name === serviceName) || projInfo.declaration.services[0]
      : projInfo.declaration.services[0];

    if (!service) {
      return { success: false, error: `No service found in project '${projectName}'.` };
    }

    const envRelPath = service.envPath || ".env";
    const envPath = path.isAbsolute(envRelPath) ? envRelPath : path.join(projInfo.projectPath, envRelPath);
    const exists = fs.existsSync(envPath);

    let content = "";
    if (exists) {
      content = fs.readFileSync(envPath, "utf-8");
    } else {
      const serviceLinkKey = store.links[`${projectName}/${service.name}`] 
        ? `${projectName}/${service.name}` 
        : (store.links[service.name] ? service.name : projectName);
      content = generateEnvContent(serviceLinkKey, service, store);
    }

    return {
      success: true,
      content,
      envPath,
      envRelPath,
      exists,
      serviceName: service.name
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Write the .env file directly and optionally restart PM2
export async function saveProjectEnvFile(
  projectName: string,
  serviceName: string | undefined,
  content: string,
  restartPm2: boolean
): Promise<{ success: boolean; error?: string; restarted?: boolean }> {
  try {
    const discovered = getDiscoveredProjects();
    const projInfo = discovered.find(p => p.declaration.name === projectName);
    if (!projInfo) {
      return { success: false, error: `Project '${projectName}' not found.` };
    }

    const service = serviceName 
      ? projInfo.declaration.services.find(s => s.name === serviceName) || projInfo.declaration.services[0]
      : projInfo.declaration.services[0];

    if (!service) {
      return { success: false, error: `No service found in project '${projectName}'.` };
    }

    const envRelPath = service.envPath || ".env";
    const envPath = path.isAbsolute(envRelPath) ? envRelPath : path.join(projInfo.projectPath, envRelPath);
    const envDir = path.dirname(envPath);

    if (!fs.existsSync(envDir)) {
      fs.mkdirSync(envDir, { recursive: true });
    }

    fs.writeFileSync(envPath, content, "utf-8");
    console.log(`Saved .env for '${service.name}' of ${projectName} at ${envPath}`);

    let restarted = false;
    if (restartPm2) {
      restarted = await restartServiceProcess(projectName, service);
    }

    return { success: true, restarted };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Apply project environment and optionally restart via PM2
export async function applyProjectEnvironment(projectName: string, serviceName?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const store = readStore();
    const discovered = getDiscoveredProjects();
    const projInfo = discovered.find(p => p.declaration.name === projectName);
    
    if (!projInfo) {
      return { success: false, error: `Project '${projectName}' not found. Make sure it has a process-manager.json file.` };
    }
    
    const servicesToApply = serviceName 
      ? projInfo.declaration.services.filter(s => s.name === serviceName)
      : projInfo.declaration.services;

    for (const service of servicesToApply) {
      // Determine link key: check `${projectName}/${service.name}` first, then `${service.name}`, then `${projectName}`
      const serviceLinkKey = store.links[`${projectName}/${service.name}`] 
        ? `${projectName}/${service.name}` 
        : (store.links[service.name] ? service.name : projectName);

      const envContent = generateEnvContent(serviceLinkKey, service, store);
      const envRelPath = service.envPath || ".env";
      const envPath = path.isAbsolute(envRelPath) ? envRelPath : path.join(projInfo.projectPath, envRelPath);

      const envDir = path.dirname(envPath);
      if (!fs.existsSync(envDir)) {
        fs.mkdirSync(envDir, { recursive: true });
      }

      fs.writeFileSync(envPath, envContent, "utf-8");
      console.log(`Successfully wrote .env for service '${service.name}' of ${projectName} at ${envPath}`);

      // Restart PM2 process
      setTimeout(async () => {
        await restartServiceProcess(projectName, service);
      }, 50);
    }
    
    return { success: true };
  } catch (error) {
    console.error(`Failed to apply project environment for ${projectName}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
