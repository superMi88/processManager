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

export interface ServiceDependency {
  project?: string;
  service?: string;
  process?: string;
  plugin?: string;
  required?: boolean;
  description?: string;
}

export interface ProjectServiceDeclaration {
  name: string;
  envPath?: string; // e.g. ".env" or "./bot/.env"
  pm2Process?: string; // e.g. "kisystem", "discord-bot"
  domain?: string;
  dependsOn?: string | (string | ServiceDependency)[];
  requirements: ProjectRequirement[];
  links?: Record<string, string>;
}

export interface ProjectDeclaration {
  name: string;
  repository?: string;
  services: ProjectServiceDeclaration[];
  requirements?: ProjectRequirement[];
  pm2Process?: string;
  dependsOn?: string | (string | ServiceDependency)[];
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
  dependsOn?: string;
}

export interface ResourceStore {
  databases: DatabaseConfig[];
  credentials: CredentialConfig[];
  links: Record<string, Record<string, string>>; // projectName -> envKey -> resourceId
  domains?: DomainConfig[];
  processLinks?: Record<string, ProcessLinkConfig>; // processName -> { dbId, port, domain, dependsOn }
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
            const defaultUsername = db.type === "mongodb" ? "" : (db.user || "postgres");
            db.users = [
              {
                id: "u-default",
                username: defaultUsername,
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

          // For mongodb, sanitize legacy "postgres" username
          if (db.type === "mongodb" && db.users) {
            db.users.forEach(u => {
              if (u.username === "postgres" && (!u.password || u.password === "")) {
                u.username = "";
                migrated = true;
              }
            });
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
  return {
    databases: [],
    credentials: [],
    links: {},
    domains: [],
    processLinks: {}
  };
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
                      dependsOn: declaration.dependsOn,
                      requirements: declaration.requirements || []
                    }
                  ];
                } else {
                  declaration.services = declaration.services.map(s => ({
                    name: s.name || declaration.name,
                    envPath: s.envPath || ".env",
                    pm2Process: s.pm2Process,
                    domain: s.domain,
                    dependsOn: s.dependsOn || declaration.dependsOn,
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
  const hasUser = Boolean(user && user.username && user.username.trim() !== "");

  if (db.type === "postgres") {
    const userPass = hasUser ? `${user!.username}:${user!.password || ""}@` : "";
    const schema = db.schema ? `?schema=${db.schema}` : "";
    return `postgresql://${userPass}${db.host}:${db.port}/${db.database}${schema}`;
  } else if (db.type === "mongodb") {
    // Only include user:pass@ if a valid, non-placeholder username exists
    const isAuth = hasUser && user!.username !== "postgres";
    const userPass = isAuth ? `${user!.username}:${user!.password || ""}@` : "";
    return `mongodb://${userPass}${db.host}:${db.port}/${db.database}`;
  }
  return "";
}

// Helper to resolve parent dependency for a service or process
export function resolveServiceDependency(
  service: { name?: string; pm2Process?: string; dependsOn?: string | (string | ServiceDependency)[] },
  store: ResourceStore,
  allDiscovered?: { declaration: ProjectDeclaration }[]
): {
  targetName: string;
  dbId?: string;
  port?: string;
  domain?: string;
  isOptional?: boolean;
  plugin?: string;
} | null {
  const procName = service.pm2Process || service.name || "";
  let depRaw = service.dependsOn || store.processLinks?.[procName]?.dependsOn;

  if (!depRaw) return null;

  let targetStr = "";
  let isOptional = false;
  let plugin: string | undefined = undefined;

  if (typeof depRaw === "string") {
    targetStr = depRaw;
  } else if (Array.isArray(depRaw) && depRaw.length > 0) {
    const first = depRaw[0];
    if (typeof first === "string") {
      targetStr = first;
    } else if (first && typeof first === "object") {
      targetStr = first.process || first.service || first.project || "";
      isOptional = first.required === false;
      plugin = first.plugin;
    }
  }

  if (!targetStr) return null;

  const parts = targetStr.split("/");
  const targetProjectOrService = parts[parts.length - 1].trim();

  let foundDbId: string | undefined = undefined;
  let foundPort: string | undefined = undefined;
  let foundDomain: string | undefined = undefined;

  // 1. Check processLinks
  for (const [pName, link] of Object.entries(store.processLinks || {})) {
    if (pName.toLowerCase() === targetProjectOrService.toLowerCase() ||
        pName.toLowerCase().replace(/[-_]/g, "") === targetProjectOrService.toLowerCase().replace(/[-_]/g, "")) {
      if (link.dbId) foundDbId = link.dbId;
      if (link.port) foundPort = link.port;
      if (link.domain) foundDomain = link.domain;
      break;
    }
  }

  // 2. Check store.links
  if (!foundDbId) {
    for (const [linkKey, links] of Object.entries(store.links || {})) {
      if (linkKey.toLowerCase().includes(targetProjectOrService.toLowerCase()) ||
          targetProjectOrService.toLowerCase().includes(linkKey.toLowerCase())) {
        if (links["DATABASE_URL"]) {
          foundDbId = links["DATABASE_URL"];
          break;
        }
      }
    }
  }

  // 3. Check discovered projects
  if (!foundDbId && allDiscovered) {
    for (const p of allDiscovered) {
      if (p.declaration.name.toLowerCase() === targetProjectOrService.toLowerCase() ||
          p.declaration.services.some(s => s.name.toLowerCase() === targetProjectOrService.toLowerCase() || s.pm2Process?.toLowerCase() === targetProjectOrService.toLowerCase())) {
        const sLink = store.links[p.declaration.name];
        if (sLink && sLink["DATABASE_URL"]) {
          foundDbId = sLink["DATABASE_URL"];
          break;
        }
      }
    }
  }

  return {
    targetName: targetProjectOrService,
    dbId: foundDbId,
    port: foundPort,
    domain: foundDomain,
    isOptional,
    plugin
  };
}

// Generate env variables content for a project or service
export function generateEnvContent(
  targetKey: string, 
  serviceOrDeclaration: { requirements?: ProjectRequirement[]; name?: string; pm2Process?: string; domain?: string; dependsOn?: string | (string | ServiceDependency)[] }, 
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

  // Check if service inherits DB from parent dependency
  const depInfo = resolveServiceDependency(serviceOrDeclaration, store);
  let inheritedDb: DatabaseConfig | undefined = undefined;
  if (depInfo?.dbId) {
    inheritedDb = store.databases.find(d => d.id === depInfo.dbId);
  }

  let dbHandled = false;

  for (const req of reqs) {
    let resourceId = projectLinks[req.key];
    let value = "";
    
    if (req.type === "database" || req.key === "DATABASE_URL") {
      dbHandled = true;
      const targetDb = (inheritedDb && (!resourceId || resourceId === inheritedDb.id)) 
        ? inheritedDb 
        : (resourceId ? store.databases.find(d => d.id === resourceId) : inheritedDb);

      if (targetDb) {
        const selectedUserId = projectLinks[`${req.key}_USER`];
        const userObj = targetDb.users?.find(u => u.id === selectedUserId) || targetDb.users?.[0];
        value = buildDatabaseUrl(targetDb, userObj);
      }
    } else if (req.type === "domain" || ["NEXTAUTH_URL", "APP_URL", "PUBLIC_URL", "DOMAIN", "REDIRECT_URI"].includes(req.key.toUpperCase())) {
      if (resourceId) {
        value = resourceId;
      } else {
        const procName = serviceOrDeclaration.pm2Process || serviceOrDeclaration.name || "";
        const procLink = store.processLinks?.[procName];
        const domainStr = procLink?.domain || serviceOrDeclaration.domain;
        
        let foundDomain = store.domains?.find(d => d.domain.toLowerCase() === (domainStr || "").toLowerCase());
        if (!foundDomain && domainStr) {
          foundDomain = { id: "d-temp", domain: domainStr, targetType: "project", targetValue: procName, sslEnabled: domainStr.startsWith("https://") || true, createdAt: "" };
        }

        if (foundDomain) {
          const ssl = foundDomain.sslEnabled ?? false;
          value = `http${ssl ? "s" : ""}://${foundDomain.domain}`;
        } else {
          const portVal = procLink?.port || projectLinks["PORT"] || reqs.find(r => r.type === "port" || r.key === "PORT")?.defaultValue || req.defaultValue || "3000";
          value = `http://localhost:${portVal}`;
        }
      }
    } else if (resourceId) {
      if (req.type === "textinput" || req.type === "text") {
        value = resourceId;
      } else {
        const cred = store.credentials.find(c => c.id === resourceId);
        if (cred) {
          value = cred.value;
        } else {
          value = resourceId;
        }
      }
    } else if (req.defaultValue) {
      value = req.defaultValue;
    }
    
    envLines.push(`# ${req.description || req.key}`);
    const formattedValue = value.includes(" ") ? `"${value}"` : value;
    envLines.push(`${req.key}=${formattedValue}`);
    envLines.push("");
  }

  // Auto-inject inherited DATABASE_URL if service didn't declare it explicitly
  if (!dbHandled && inheritedDb) {
    const userObj = inheritedDb.users?.[0];
    const inheritedUrl = buildDatabaseUrl(inheritedDb, userObj);
    envLines.push(`# Automatisch geerbt von ${depInfo?.targetName || "Abhängigkeit"}`);
    envLines.push(`DATABASE_URL=${inheritedUrl}`);
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

    // Cascade .env update to dependent projects that inherit from this project/service
    for (const otherProj of discovered) {
      if (otherProj.declaration.name === projectName) continue;
      for (const otherService of otherProj.declaration.services) {
        const dep = resolveServiceDependency(otherService, store, discovered);
        if (dep && (
          dep.targetName.toLowerCase() === projectName.toLowerCase() ||
          servicesToApply.some(s => s.name.toLowerCase() === dep.targetName.toLowerCase() || s.pm2Process?.toLowerCase() === dep.targetName.toLowerCase())
        )) {
          console.log(`Cascading environment update to dependent service '${otherService.name}' of project '${otherProj.declaration.name}'...`);
          const otherKey = store.links[`${otherProj.declaration.name}/${otherService.name}`] 
            ? `${otherProj.declaration.name}/${otherService.name}` 
            : (store.links[otherService.name] ? otherService.name : otherProj.declaration.name);
          const childEnv = generateEnvContent(otherKey, otherService, store);
          const childRel = otherService.envPath || ".env";
          const childPath = path.isAbsolute(childRel) ? childRel : path.join(otherProj.projectPath, childRel);
          const childDir = path.dirname(childPath);
          if (!fs.existsSync(childDir)) {
            fs.mkdirSync(childDir, { recursive: true });
          }
          fs.writeFileSync(childPath, childEnv, "utf-8");
          setTimeout(async () => {
            await restartServiceProcess(otherProj.declaration.name, otherService);
          }, 150);
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error(`Failed to apply project environment for ${projectName}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
