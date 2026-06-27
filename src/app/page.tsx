"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./dashboard.module.css";

interface ProcessInfo {
  id: number;
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

interface DatabaseInfo {
  type: "postgres" | "mongodb" | "unknown";
  name: string;
  host: string;
  user: string;
  password?: string;
  sourceProcess: string;
  status: "online" | "offline";
  sizeBytes: number;
  connectionCount?: number;
  tablesCount?: number;
  collectionsCount?: number;
  documentsCount?: number;
  maskedUri: string;
  error?: string;
}

interface RegisteredDatabase {
  id: string;
  alias: string;
  type: "postgres" | "mongodb";
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  schema?: string;
}

interface RegisteredCredential {
  id: string;
  alias: string;
  key: string;
  value: string;
  type?: "google" | "port";
}

interface ProjectRequirement {
  key: string;
  type: "database" | "credential";
  dbType?: "postgres" | "mongodb";
  description?: string;
}

interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  dbId: string;
  database: string;
  path: string;
}

interface DiscoveredProject {
  name: string;
  path: string;
  requirements: ProjectRequirement[];
  links: Record<string, string>;
  hasPrisma?: boolean;
  hasMigrations?: boolean;
}


export default function DashboardPage() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDbsLoading, setIsDbsLoading] = useState(true);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});
  
  const router = useRouter();
  const consoleRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<"dashboard" | "databases" | "keys" | "projects">("dashboard");
  const [registeredDbs, setRegisteredDbs] = useState<RegisteredDatabase[]>([]);
  const [registeredCreds, setRegisteredCreds] = useState<RegisteredCredential[]>([]);
  const [discoveredProjects, setDiscoveredProjects] = useState<DiscoveredProject[]>([]);
  const [isResourcesLoading, setIsResourcesLoading] = useState(true);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [scannedPorts, setScannedPorts] = useState<{ port: number; inUse: boolean; registered: boolean; alias: string | null; credentialId: string | null; projectName: string | null }[]>([]);
  const [isPortsLoading, setIsPortsLoading] = useState(false);
  
  // Google Key Form states
  const [googleAlias, setGoogleAlias] = useState("");
  const [googleKeyName, setGoogleKeyName] = useState("GOOGLE_API_KEY");
  const [googleValue, setGoogleValue] = useState("");
  const [editingGoogleId, setEditingGoogleId] = useState<string | null>(null);
  const [googleKeyCustomMode, setGoogleKeyCustomMode] = useState(false);
  const [customGoogleKey, setCustomGoogleKey] = useState("");

  // Port Form states
  const [portAlias, setPortAlias] = useState("");
  const [portKeyName, setPortKeyName] = useState("PORT");
  const [selectedPort, setSelectedPort] = useState("");
  const [customPortValue, setCustomPortValue] = useState("");
  const [portCustomMode, setPortCustomMode] = useState(false);
  const [editingPortId, setEditingPortId] = useState<string | null>(null);
  
  // Database form state
  const [dbAlias, setDbAlias] = useState("");
  const [dbType, setDbType] = useState<"postgres" | "mongodb">("postgres");
  const [dbHost, setDbHost] = useState("localhost");
  const [dbPort, setDbPort] = useState(5432);
  const [dbUser, setDbUser] = useState("");
  const [dbPassword, setDbPassword] = useState("");
  const [dbDatabase, setDbDatabase] = useState("");
  const [dbSchema, setDbSchema] = useState("public");
  const [editingDbId, setEditingDbId] = useState<string | null>(null);

  // Database form mode & Provisioning states
  const [dbFormMode, setDbFormMode] = useState<"register" | "create">("register");
  const [adminDbType, setAdminDbType] = useState<"postgres" | "mongodb">("postgres");
  const [adminHost, setAdminHost] = useState("localhost");
  const [adminPort, setAdminPort] = useState(5432);
  const [adminUser, setAdminUser] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminDatabase, setAdminDatabase] = useState("");
  const [selectedAdminDbId, setSelectedAdminDbId] = useState<string>("custom");
  const [isProvisioningLoading, setIsProvisioningLoading] = useState(false);


  
  // Project mapping changes state (projectName -> envKey -> resourceId)
  const [pendingLinks, setPendingLinks] = useState<Record<string, Record<string, string>>>({});
  const [isSavingProject, setIsSavingProject] = useState<Record<string, boolean>>({});

  // Migration states
  const [migrationLogs, setMigrationLogs] = useState<string>("");
  const [isMigrationRunning, setIsMigrationRunning] = useState<Record<string, boolean>>({});
  const [newMigrationName, setNewMigrationName] = useState<Record<string, string>>({});
  const [activeProjectForLogs, setActiveProjectForLogs] = useState<string | null>(null);

  // Backup states
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [selectedDbForBackups, setSelectedDbForBackups] = useState<RegisteredDatabase | null>(null);
  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [isBackupCreating, setIsBackupCreating] = useState(false);

  // Trigger Prisma Actions
  const handlePrismaAction = async (projectName: string, action: string, extraArgs: Record<string, string | number | boolean> = {}) => {
    setIsMigrationRunning(prev => ({ ...prev, [projectName]: true }));
    setMigrationLogs("Führe Befehl aus... Bitte warten...\n");
    setActiveProjectForLogs(projectName);
    
    try {
      const res = await fetch("/api/manager/database/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          projectName,
          ...extraArgs
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        setMigrationLogs(data.output || "Befehl erfolgreich abgeschlossen, kein Output erhalten.");
        // Refresh projects to update hasMigrations indicator if we baselined
        fetchProjects();
      } else {
        setMigrationLogs(`Fehler bei der Ausführung:\n${data.error || data.output || "Unbekannter Fehler"}`);
      }
    } catch (err) {
      setMigrationLogs(`Verbindungsfehler:\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsMigrationRunning(prev => ({ ...prev, [projectName]: false }));
    }
  };

  // Backups helper
  const fetchBackups = async (dbId: string) => {
    setIsBackupLoading(true);
    try {
      const res = await fetch("/api/manager/database/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-list", dbId })
      });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      }
    } catch (err) {
      console.error("Failed to load backups:", err);
    } finally {
      setIsBackupLoading(false);
    }
  };

  const handleCreateBackup = async (dbId: string) => {
    setIsBackupCreating(true);
    try {
      const res = await fetch("/api/manager/database/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-create", dbId })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Backup erfolgreich erstellt!");
        fetchBackups(dbId);
      } else {
        alert(`Fehler beim Erstellen des Backups: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler bei der Verbindung.");
    } finally {
      setIsBackupCreating(false);
    }
  };

  const handleRestoreBackup = async (dbId: string, filename: string) => {
    if (!confirm(`Möchtest du das Backup '${filename}' wirklich wiederherstellen? Alle bestehenden Daten werden überschrieben!`)) {
      return;
    }
    setIsBackupLoading(true);
    try {
      const res = await fetch("/api/manager/database/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-restore", dbId, filename })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Backup erfolgreich wiederhergestellt!");
      } else {
        alert(`Fehler beim Wiederherstellen: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler bei der Verbindung.");
    } finally {
      setIsBackupLoading(false);
      fetchDatabases(true); // refresh DB sizes
    }
  };

  const handleDeleteBackup = async (dbId: string, filename: string) => {
    if (!confirm(`Möchtest du das Backup '${filename}' wirklich unwiderruflich löschen?`)) {
      return;
    }
    try {
      const res = await fetch("/api/manager/database/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-delete", filename })
      });
      if (res.ok) {
        fetchBackups(dbId);
      } else {
        const data = await res.json();
        alert(`Fehler beim Löschen: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler bei der Verbindung.");
    }
  };

  const fetchResources = useCallback(async () => {
    setIsResourcesLoading(true);
    try {
      const response = await fetch("/api/manager/resources");
      if (response.ok) {
        const data = await response.json();
        setRegisteredDbs(data.databases || []);
        setRegisteredCreds(data.credentials || []);
      }
    } catch (error) {
      console.error("Error fetching resources:", error);
    } finally {
      setIsResourcesLoading(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    setIsProjectsLoading(true);
    try {
      const response = await fetch("/api/manager/projects");
      if (response.ok) {
        const data = await response.json();
        setDiscoveredProjects(data.projects || []);
        const links: Record<string, Record<string, string>> = {};
        for (const p of data.projects || []) {
          links[p.name] = { ...p.links };
        }
        setPendingLinks(links);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setIsProjectsLoading(false);
    }
  }, []);

  const fetchPorts = useCallback(async (showLoading = false) => {
    if (showLoading) setIsPortsLoading(true);
    try {
      const response = await fetch("/api/manager/ports");
      if (response.ok) {
        const data = await response.json();
        setScannedPorts(data.ports || []);
      }
    } catch (error) {
      console.error("Error fetching ports:", error);
    } finally {
      setIsPortsLoading(false);
    }
  }, []);

  // Save Google Key
  const handleSaveGoogleKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalKey = googleKeyCustomMode ? customGoogleKey : googleKeyName;
    if (!googleAlias || !finalKey || !googleValue) {
      alert("Bitte fülle alle Pflichtfelder für den Google API Key aus.");
      return;
    }
    
    const credData = {
      id: editingGoogleId || undefined,
      alias: googleAlias,
      key: finalKey,
      value: googleValue,
      type: "google"
    };

    try {
      const res = await fetch("/api/manager/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", type: "credential", data: credData })
      });
      if (res.ok) {
        const data = await res.json();
        setRegisteredCreds(data.credentials || []);
        setGoogleAlias("");
        setGoogleValue("");
        setCustomGoogleKey("");
        setGoogleKeyCustomMode(false);
        setGoogleKeyName("GOOGLE_API_KEY");
        setEditingGoogleId(null);
        alert("Google API Key erfolgreich gespeichert!");
        fetchProjects();
      } else {
        const err = await res.json();
        alert(`Fehler beim Speichern: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Speichern des Google API Keys.");
    }
  };

  // Save Port
  const handleSavePort = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalPortValue = portCustomMode ? customPortValue : selectedPort;
    const finalKey = portKeyName || "PORT";
    if (!portAlias || !finalPortValue) {
      alert("Bitte fülle alle Pflichtfelder für den Port aus.");
      return;
    }
    
    const duplicate = registeredCreds.find(c => {
      const isPort = c.type === "port" || c.key === "PORT" || c.key.includes("PORT");
      return isPort && c.value === finalPortValue && c.id !== editingPortId;
    });
    if (duplicate) {
      alert(`Dieser Port (${finalPortValue}) wird bereits als '${duplicate.alias}' verwendet!`);
      return;
    }

    const credData = {
      id: editingPortId || undefined,
      alias: portAlias,
      key: finalKey,
      value: finalPortValue,
      type: "port"
    };

    try {
      const res = await fetch("/api/manager/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", type: "credential", data: credData })
      });
      if (res.ok) {
        const data = await res.json();
        setRegisteredCreds(data.credentials || []);
        setPortAlias("");
        setSelectedPort("");
        setCustomPortValue("");
        setPortCustomMode(false);
        setEditingPortId(null);
        alert("Port erfolgreich gespeichert!");
        fetchProjects();
        fetchPorts(true);
      } else {
        const err = await res.json();
        alert(`Fehler beim Speichern: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Speichern des Ports.");
    }
  };

  // Save database
  const handleSaveDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbAlias || !dbHost || !dbDatabase) {
      alert("Bitte fülle alle Pflichtfelder für die Datenbank aus.");
      return;
    }
    
    const dbData = {
      id: editingDbId || undefined,
      alias: dbAlias,
      type: dbType,
      host: dbHost,
      port: Number(dbPort),
      user: dbUser,
      password: dbPassword,
      database: dbDatabase,
      schema: dbType === "postgres" ? dbSchema : undefined
    };

    try {
      const res = await fetch("/api/manager/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", type: "database", data: dbData })
      });
      if (res.ok) {
        const data = await res.json();
        setRegisteredDbs(data.databases || []);
        setDbAlias("");
        setDbType("postgres");
        setDbHost("localhost");
        setDbPort(5432);
        setDbUser("");
        setDbPassword("");
        setDbDatabase("");
        setDbSchema("public");
        setEditingDbId(null);
        alert("Datenbank erfolgreich gespeichert!");
        fetchProjects();
      } else {
        const err = await res.json();
        alert(`Fehler beim Speichern: ${err.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Speichern der Datenbank.");
    }
  };

  // Handle template database server change
  const handleAdminDbTemplateChange = (templateId: string) => {
    setSelectedAdminDbId(templateId);
    if (templateId === "custom") {
      return;
    }
    if (templateId === "postgres-default") {
      setAdminDbType("postgres");
      setAdminHost("localhost");
      setAdminPort(5432);
      setAdminUser("postgres");
      setAdminPassword("");
      setAdminDatabase("postgres");
    } else if (templateId === "mongodb-default") {
      setAdminDbType("mongodb");
      setAdminHost("localhost");
      setAdminPort(27017);
      setAdminUser("");
      setAdminPassword("");
      setAdminDatabase("admin");
    } else {
      const found = registeredDbs.find(d => d.id === templateId);
      if (found) {
        setAdminDbType(found.type);
        setAdminHost(found.host);
        setAdminPort(found.port);
        setAdminUser(found.user || "");
        setAdminPassword(found.password || "");
        setAdminDatabase(found.database || "");
      }
    }
  };

  // Provision a new database
  const handleProvisionDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbAlias || !dbDatabase || !dbUser || !dbPassword) {
      alert("Bitte fülle alle Pflichtfelder für die neue Datenbank aus.");
      return;
    }
    setIsProvisioningLoading(true);
    try {
      const adminConnection = {
        type: adminDbType,
        host: adminHost,
        port: Number(adminPort),
        user: adminUser,
        password: adminPassword,
        database: adminDatabase || (adminDbType === "postgres" ? "postgres" : "admin")
      };

      const newDatabase = {
        alias: dbAlias,
        database: dbDatabase,
        user: dbUser,
        password: dbPassword,
        schema: adminDbType === "postgres" ? dbSchema : undefined
      };

      const res = await fetch("/api/manager/resources/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminConnection, newDatabase })
      });

      const data = await res.json();
      if (res.ok) {
        setRegisteredDbs(data.databases || []);
        // Reset fields
        setDbAlias("");
        setDbDatabase("");
        setDbUser("");
        setDbPassword("");
        setDbSchema("public");
        setSelectedAdminDbId("custom");
        setDbFormMode("register"); // switch back to registration view
        alert(data.message || "Datenbank erfolgreich erstellt und registriert!");
        fetchProjects();
      } else {
        alert(`Fehler beim Erstellen der Datenbank: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Verbindungsfehler beim Erstellen der Datenbank.");
    } finally {
      setIsProvisioningLoading(false);
    }
  };

  // Helper to normalise host and check registration
  const isAlreadyRegistered = (scannedDb: DatabaseInfo) => {
    return registeredDbs.some(r => {
      const rHost = r.host === "127.0.0.1" ? "localhost" : r.host.toLowerCase();
      const sHost = scannedDb.host === "127.0.0.1" ? "localhost" : scannedDb.host.toLowerCase();
      
      let scannedHostname = sHost;
      let scannedPort = scannedDb.type === "postgres" ? 5432 : 27017;
      if (sHost.includes(":")) {
        const parts = sHost.split(":");
        scannedHostname = parts[0];
        scannedPort = Number(parts[1]);
      }
      
      return rHost === scannedHostname && r.port === scannedPort && r.database === scannedDb.name;
    });
  };

  // Pre-fill form from a discovered database
  const handleRegisterDiscovered = (db: DatabaseInfo) => {
    setDbFormMode("register");
    setEditingDbId(null);
    setDbAlias(`${db.name} (${db.sourceProcess !== "system-default" ? db.sourceProcess : "Lokal"})`);
    setDbType(db.type === "postgres" ? "postgres" : "mongodb");
    
    const hostPart = db.host.includes(":") ? db.host.split(":")[0] : db.host;
    const portPart = db.host.includes(":") ? Number(db.host.split(":")[1]) : (db.type === "postgres" ? 5432 : 27017);
    
    setDbHost(hostPart);
    setDbPort(portPart);
    setDbDatabase(db.name);
    setDbUser(db.user || "");
    setDbPassword(db.password || "");
    setDbSchema("public");
    
    // Smooth scroll to database form card
    document.getElementById("database-form-card")?.scrollIntoView({ behavior: "smooth" });
  };

  // Delete database
  const handleDeleteDatabase = async (id: string) => {
    if (!confirm("Möchtest du diese Datenbank wirklich löschen? Alle Verknüpfungen werden ebenfalls entfernt.")) {
      return;
    }
    try {
      const res = await fetch("/api/manager/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", type: "database", data: { id } })
      });
      if (res.ok) {
        const data = await res.json();
        setRegisteredDbs(data.databases || []);
        fetchProjects();
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Löschen.");
    }
  };

  // Delete credential
  const handleDeleteCredential = async (id: string) => {
    if (!confirm("Möchtest du diese Zugangsdaten wirklich löschen? Alle Verknüpfungen werden ebenfalls entfernt.")) {
      return;
    }
    try {
      const res = await fetch("/api/manager/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", type: "credential", data: { id } })
      });
      if (res.ok) {
        const data = await res.json();
        setRegisteredCreds(data.credentials || []);
        fetchProjects();
        fetchPorts(true);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Löschen.");
    }
  };

  // Edit form helpers
  const startEditDb = (db: RegisteredDatabase) => {
    setEditingDbId(db.id);
    setDbAlias(db.alias);
    setDbType(db.type);
    setDbHost(db.host);
    setDbPort(db.port);
    setDbUser(db.user);
    setDbPassword(db.password || "");
    setDbDatabase(db.database);
    setDbSchema(db.schema || "public");
  };



  // Handle mapping updates in dropdowns
  const handleLinkChange = (projectName: string, envKey: string, resourceId: string) => {
    setPendingLinks(prev => ({
      ...prev,
      [projectName]: {
        ...(prev[projectName] || {}),
        [envKey]: resourceId
      }
    }));
  };

  // Save and apply mappings
  const handleApplyProject = async (projectName: string) => {
    setIsSavingProject(prev => ({ ...prev, [projectName]: true }));
    try {
      const links = pendingLinks[projectName] || {};
      const res = await fetch("/api/manager/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", projectName, links })
      });
      
      const data = await res.json();
      if (res.ok) {
        alert(data.message || `Verknüpfungen für ${projectName} erfolgreich angewendet!`);
        fetchProjects();
      } else {
        alert(`Fehler beim Anwenden: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Anwenden der Konfiguration.");
    } finally {
      setIsSavingProject(prev => ({ ...prev, [projectName]: false }));
    }
  };

  // Fetch process list

  const fetchProcesses = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const response = await fetch("/api/pm2");
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch processes");
      }
      const data = await response.json();
      setProcesses(data);
    } catch (error) {
      console.error("Error fetching processes:", error);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  // Fetch databases list
  const fetchDatabases = useCallback(async (showLoading = false) => {
    if (showLoading) setIsDbsLoading(true);
    try {
      const response = await fetch("/api/databases");
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch databases");
      }
      const data = await response.json();
      setDatabases(data);
    } catch (error) {
      console.error("Error fetching databases:", error);
    } finally {
      setIsDbsLoading(false);
    }
  }, [router]);

  // Fetch user session info
  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth");
      if (response.ok) {
        const data = await response.json();
        setUserEmail(data.email || "Admin");
      } else if (response.status === 401) {
        router.push("/login");
      }
    } catch (error) {
      console.error("Error fetching session:", error);
    }
  }, [router]);

  // Fetch process logs
  const fetchLogs = useCallback(async (processName: string, isSilent = false) => {
    if (!isSilent) setIsLogsLoading(true);
    try {
      const response = await fetch(`/api/pm2/${processName}?lines=100`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error("Error fetching logs:", error);
      setLogs([`[SYSTEM] Fehler beim Abrufen der Logs für ${processName}`]);
    } finally {
      setIsLogsLoading(false);
    }
  }, []);

  // Execute process commands
  const handleProcessAction = async (processName: string, action: "start" | "stop" | "restart") => {
    setActionInProgress((prev) => ({ ...prev, [`${processName}-${action}`]: true }));
    try {
      const response = await fetch(`/api/pm2/${processName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(`Aktion fehlgeschlagen: ${data.error || "Unbekannter Fehler"}`);
      } else {
        // Refresh processes immediately
        await fetchProcesses();
        
        // If logs of this process are currently being viewed, refresh logs too
        if (selectedProcess?.name === processName) {
          await fetchLogs(processName, true);
        }
      }
    } catch (error) {
      console.error(`Error executing action ${action} on ${processName}:`, error);
      alert(`Verbindungsfehler bei der Ausführung von '${action}'.`);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [`${processName}-${action}`]: false }));
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (response.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }
  };



  useEffect(() => {
    const initializeDashboard = async () => {
      await fetchSession();
      await fetchProcesses(true);
      await fetchDatabases(true);
      await fetchResources();
      await fetchProjects();
      await fetchPorts(false);
    };
    initializeDashboard();

    const processInterval = setInterval(() => {
      fetchProcesses(false);
    }, 3000);

    const dbInterval = setInterval(() => {
      fetchDatabases(false);
    }, 3000);

    return () => {
      clearInterval(processInterval);
      clearInterval(dbInterval);
    };
  }, [fetchSession, fetchProcesses, fetchDatabases, fetchResources, fetchProjects, fetchPorts]);

  useEffect(() => {
    if (activeTab !== "keys") return;
    const timer = setTimeout(() => {
      fetchPorts(false);
    }, 0);
    const interval = setInterval(() => {
      fetchPorts(false);
    }, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [activeTab, fetchPorts]);

  // Poll logs if a process is selected
  useEffect(() => {
    if (!selectedProcess) {
      return;
    }

    // Fetch immediately on select
    const loadInitialLogs = async () => {
      await fetchLogs(selectedProcess.name, false);
    };
    loadInitialLogs();

    const logsInterval = setInterval(() => {
      fetchLogs(selectedProcess.name, true);
    }, 3000);

    return () => clearInterval(logsInterval);
  }, [selectedProcess, fetchLogs]);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  // PM2 Stats calculations
  const totalProcesses = processes.length;
  const runningProcesses = processes.filter((p) => p.status === "online").length;
  const stoppedProcesses = processes.filter((p) => p.status === "stopped" || p.status === "errored").length;
  
  const totalCpu = Number(
    processes
      .filter((p) => p.status === "online")
      .reduce((sum, p) => sum + p.cpu, 0)
      .toFixed(1)
  );

  const totalMemoryBytes = processes
    .filter((p) => p.status === "online")
    .reduce((sum, p) => sum + p.memory, 0);

  // Database Stats calculations
  const totalDatabases = databases.length;
  const onlineDatabases = databases.filter((db) => db.status === "online").length;
  const offlineDatabases = databases.filter((db) => db.status === "offline").length;
  const totalDbsSizeBytes = databases
    .filter((db) => db.status === "online")
    .reduce((sum, db) => sum + db.sizeBytes, 0);

  // Helper: Format Memory bytes
  const formatMemory = (bytes: number) => {
    if (bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  // Helper: Format Uptime
  const formatUptime = (ms: number) => {
    if (ms <= 0) return "—";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  // Helper: Get status badge class
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "online":
        return <span className="badge badge-online"><span className="pulse-dot pulse-dot-online"></span>Online</span>;
      case "stopped":
        return <span className="badge badge-stopped"><span className="pulse-dot pulse-dot-stopped"></span>Stopped</span>;
      default:
        return <span className="badge badge-errored"><span className="pulse-dot pulse-dot-errored"></span>{status}</span>;
    }
  };
  const googleCreds = registeredCreds.filter(cred => {
    if (cred.type) return cred.type === "google";
    return !(cred.key === "PORT" || cred.key.includes("PORT"));
  });

  const portCreds = registeredCreds.filter(cred => {
    if (cred.type) return cred.type === "port";
    return cred.key === "PORT" || cred.key.includes("PORT");
  });
  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={`${styles.title} glow-text-gradient`}>ProcessManager</h1>
          <p className={styles.userInfo}>Angemeldet als: <strong>{userEmail}</strong></p>
        </div>
        <div className={styles.headerRight}>
          <button 
            onClick={() => {
              fetchProcesses(true);
              fetchDatabases(true);
            }} 
            className="btn btn-secondary" 
            title="Aktualisieren"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
            </svg>
            <span>Aktualisieren</span>
          </button>
          <button onClick={handleLogout} className={`${styles.logoutBtn} btn btn-secondary`}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span>Abmelden</span>
          </button>
        </div>
      </header>

      {/* Tabs Switcher */}
      <div className={styles.tabsContainer}>
        <button 
          onClick={() => setActiveTab("dashboard")} 
          className={`${styles.tabButton} ${activeTab === "dashboard" ? styles.tabButtonActive : ""}`}
        >
          Dashboard
        </button>
        <button 
          onClick={() => {
            setActiveTab("databases");
            fetchDatabases(true);
            fetchResources();
          }} 
          className={`${styles.tabButton} ${activeTab === "databases" ? styles.tabButtonActive : ""}`}
        >
          Datenbanken
        </button>
        <button 
          onClick={() => {
            setActiveTab("keys");
            fetchResources();
            fetchPorts(true);
          }} 
          className={`${styles.tabButton} ${activeTab === "keys" ? styles.tabButtonActive : ""}`}
        >
          Keys & Ports
        </button>
        <button 
          onClick={() => {
            setActiveTab("projects");
            fetchProjects();
            fetchResources();
          }} 
          className={`${styles.tabButton} ${activeTab === "projects" ? styles.tabButtonActive : ""}`}
        >
          Projekte
        </button>
      </div>

      {activeTab === "dashboard" && (
        <>
          {/* System Resources & DB Stats Grid */}
          <section className={styles.statsGrid}>
            {/* PM2 Processes Card */}
            <div className={`${styles.statCard} glass-panel`}>
              <div className={styles.statHeader}>
                <span>Gesamt Prozesse</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                  <line x1="6" y1="6" x2="6.01" y2="6"></line>
                  <line x1="6" y1="18" x2="6.01" y2="18"></line>
                </svg>
              </div>
              <div className={styles.statValue}>{totalProcesses}</div>
              <div className={styles.statDetails}>
                {runningProcesses} aktiv &bull; {stoppedProcesses} inaktiv
              </div>
            </div>

            {/* CPU Card */}
            <div className={`${styles.statCard} glass-panel`}>
              <div className={styles.statHeader}>
                <span>CPU-Auslastung (PM2)</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="9" y1="3" x2="9" y2="21"></line>
                  <line x1="15" y1="3" x2="15" y2="21"></line>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="3" y1="15" x2="21" y2="15"></line>
                </svg>
              </div>
              <div className={styles.statValue}>{totalCpu}%</div>
              <div className={styles.statBarBg}>
                <div className={styles.statBarFill} style={{ width: `${Math.min(100, totalCpu)}%` }}></div>
              </div>
            </div>

            {/* RAM Card */}
            <div className={`${styles.statCard} glass-panel`}>
              <div className={styles.statHeader}>
                <span>Arbeitsspeicher (PM2)</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2">
                  <path d="M6 2v20M18 2v20M6 6h12M6 10h12M6 14h12M6 18h12"></path>
                </svg>
              </div>
              <div className={styles.statValue}>{formatMemory(totalMemoryBytes)}</div>
              <div className={styles.statDetails}>RAM aller aktiven PM2-Prozesse</div>
            </div>

            {/* Databases Count Card */}
            <div className={`${styles.statCard} glass-panel`}>
              <div className={styles.statHeader}>
                <span>Erkannte Datenbanken</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                  <path d="M12 22c5.523 0 10-2.239 10-5s-4.477-5-10-5S2 14.239 2 17s4.477 5 10 5z"></path>
                  <path d="M22 17v-5c0-2.761-4.477-5-10-5S2 9.239 2 12v5"></path>
                  <path d="M22 12V7c0-2.761-4.477-5-10-5S2 4.239 2 7v5"></path>
                </svg>
              </div>
              <div className={styles.statValue}>{totalDatabases}</div>
              <div className={styles.statDetails}>
                {onlineDatabases} Online &bull; {offlineDatabases} Offline
              </div>
            </div>

            {/* Database Storage Card */}
            <div className={`${styles.statCard} glass-panel`}>
              <div className={styles.statHeader}>
                <span>Gesamte Datengröße</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                  <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                </svg>
              </div>
              <div className={styles.statValue}>{formatMemory(totalDbsSizeBytes)}</div>
              <div className={styles.statDetails}>Speicherplatz aller aktiven DBs</div>
            </div>
          </section>

          {/* Main Content: Processes Table */}
          <section>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>PM2 Prozesse</h2>
            </div>

            {isLoading ? (
              <div className="glass-panel" style={{ padding: "4rem", textAlign: "center" }}>
                <svg
                  className="spinner"
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                >
                  <circle cx="12" cy="12" r="10" strokeDasharray="40 20"></circle>
                </svg>
                <p style={{ marginTop: "1rem", color: "var(--text-secondary)" }}>Prozessliste wird geladen...</p>
              </div>
            ) : processes.length === 0 ? (
              <div className={`${styles.tableWrapper} glass-panel`}>
                <div className={styles.emptyState}>
                  <svg
                    className={styles.emptyStateIcon}
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                  </svg>
                  <p>Keine PM2-Prozesse gefunden.</p>
                  <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    Stelle sicher, dass PM2 auf dem Server läuft und Prozesse registriert sind.
                  </p>
                </div>
              </div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.processTable}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>CPU</th>
                      <th>RAM</th>
                      <th>Restarts</th>
                      <th>Uptime</th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.map((proc) => {
                      const isStarting = actionInProgress[`${proc.name}-start`];
                      const isStopping = actionInProgress[`${proc.name}-stop`];
                      const isRestarting = actionInProgress[`${proc.name}-restart`];
                      const isAnyAction = isStarting || isStopping || isRestarting;

                      return (
                        <tr 
                          key={proc.id + "-" + proc.name}
                          style={{
                            background: selectedProcess?.name === proc.name ? "rgba(59, 130, 246, 0.05)" : undefined,
                          }}
                        >
                          <td>
                            <div className={styles.processName}>
                              <span>{proc.name}</span>
                              <span className={styles.pmId}>ID: {proc.id}</span>
                              {proc.pid > 0 && <span className={styles.pmId}>PID: {proc.pid}</span>}
                            </div>
                          </td>
                          <td>{getStatusBadge(proc.status)}</td>
                          <td className={styles.monoText}>{proc.status === "online" ? `${proc.cpu}%` : "—"}</td>
                          <td className={styles.monoText}>{proc.status === "online" ? formatMemory(proc.memory) : "—"}</td>
                          <td className={styles.monoText}>{proc.restarts}</td>
                          <td className={styles.monoText}>{formatUptime(proc.uptime)}</td>
                          <td>
                            <div className={styles.actionsCell}>
                              {proc.status === "online" ? (
                                <button
                                  onClick={() => handleProcessAction(proc.name, "stop")}
                                  disabled={isAnyAction}
                                  className={`${styles.actionBtn} ${styles.actionBtnStop}`}
                                  title="Stoppen"
                                >
                                  {isStopping ? (
                                    <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                                  ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
                                  )}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleProcessAction(proc.name, "start")}
                                  disabled={isAnyAction}
                                  className={`${styles.actionBtn} ${styles.actionBtnStart}`}
                                  title="Starten"
                                >
                                  {isStarting ? (
                                    <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                                  ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                  )}
                                </button>
                              )}

                              <button
                                onClick={() => handleProcessAction(proc.name, "restart")}
                                disabled={isAnyAction}
                                className={`${styles.actionBtn} ${styles.actionBtnRestart}`}
                                title="Neustarten"
                              >
                                {isRestarting ? (
                                  <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
                                )}
                              </button>

                              <button
                                onClick={() => {
                                  if (selectedProcess?.name === proc.name) {
                                    setSelectedProcess(null);
                                    setLogs([]);
                                  } else {
                                    setSelectedProcess(proc);
                                  }
                                }}
                                className={styles.actionBtn}
                                style={{
                                  background: selectedProcess?.name === proc.name ? "rgba(59, 130, 246, 0.2)" : undefined,
                                  borderColor: selectedProcess?.name === proc.name ? "var(--primary)" : undefined,
                                  color: selectedProcess?.name === proc.name ? "#fff" : undefined,
                                }}
                                title="Logs anzeigen"
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                  <polyline points="14 2 14 8 20 8"></polyline>
                                  <line x1="16" y1="13" x2="8" y2="13"></line>
                                  <line x1="16" y1="17" x2="8" y2="17"></line>
                                  <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Databases Discovery section removed from dashboard (now in Databases & Keys tab) */}

          {/* Logs View Panel */}
          {selectedProcess && (
            <section className={styles.logsSection}>
              <div className={styles.logsPanel}>
                <div className={styles.logsHeader}>
                  <div className={styles.logsTitle}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5"></polyline>
                      <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                    <span>Logs: <strong>{selectedProcess.name}</strong></span>
                  </div>
                  <div className={styles.logsHeaderRight}>
                    {isLogsLoading && (
                      <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle>
                      </svg>
                    )}
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Live-Aktualisierung (3s)</span>
                    <button
                      onClick={() => {
                        setSelectedProcess(null);
                        setLogs([]);
                      }}
                      className="btn btn-secondary btn-icon"
                      style={{ width: "28px", height: "28px", borderRadius: "6px" }}
                      title="Schließen"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
                
                <div ref={consoleRef} className={styles.logsConsole}>
                  {logs.length === 0 ? (
                    <div className={styles.logLine + " " + styles.logLineSystem}>
                      Warte auf Log-Daten...
                    </div>
                  ) : (
                    logs.map((line, idx) => {
                      let lineClass = styles.logLine;
                      if (line.startsWith("[STDOUT]")) {
                        lineClass += ` ${styles.logLineStdout}`;
                      } else if (line.startsWith("[STDERR]")) {
                        lineClass += ` ${styles.logLineStderr}`;
                      } else if (line.startsWith("[SYSTEM]")) {
                        lineClass += ` ${styles.logLineSystem}`;
                      }
                      return (
                        <div key={idx} className={lineClass}>
                          {line}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Tab: Datenbanken Manager */}
      {activeTab === "databases" && (
        <div className="layout-main" style={{ animation: "fadeIn 0.3s ease-out" }}>
          <h2 className={styles.sectionTitle} style={{ marginBottom: "1rem" }}>Zentrale Datenbanken</h2>
          <div className={styles.settingsGrid} style={{ marginBottom: "3rem" }}>
            {/* Database Form Card */}
            <div id="database-form-card" className={`${styles.settingsCard} glass-panel`}>
              {/* Tab-Toggler inside the card header */}
              <div style={{ display: "flex", gap: "1.5rem", borderBottom: "1px solid var(--border-glass)", marginBottom: "1.5rem", paddingBottom: "0.75rem" }}>
                <button 
                  type="button"
                  onClick={() => { setDbFormMode("register"); setEditingDbId(null); }}
                  className={`${styles.tabButton} ${dbFormMode === "register" ? styles.tabButtonActive : ""}`}
                  style={{ 
                    padding: "0.25rem 0.5rem", 
                    fontSize: "0.95rem", 
                    background: "none", 
                    border: "none", 
                    cursor: "pointer", 
                    borderBottom: dbFormMode === "register" ? "2px solid var(--primary)" : "none", 
                    color: dbFormMode === "register" ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: dbFormMode === "register" ? 600 : 400
                  }}
                >
                  {editingDbId ? "Datenbank bearbeiten" : "Datenbank registrieren"}
                </button>
                {!editingDbId && (
                  <button 
                    type="button"
                    onClick={() => setDbFormMode("create")}
                    className={`${styles.tabButton} ${dbFormMode === "create" ? styles.tabButtonActive : ""}`}
                    style={{ 
                      padding: "0.25rem 0.5rem", 
                      fontSize: "0.95rem", 
                      background: "none", 
                      border: "none", 
                      cursor: "pointer", 
                      borderBottom: dbFormMode === "create" ? "2px solid var(--primary)" : "none", 
                      color: dbFormMode === "create" ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: dbFormMode === "create" ? 600 : 400
                    }}
                  >
                    Datenbank erstellen
                  </button>
                )}
              </div>

              {dbFormMode === "register" ? (
                <form onSubmit={handleSaveDatabase} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div className="input-group">
                    <label className="input-label">Aliasname *</label>
                    <input 
                      type="text" 
                      value={dbAlias} 
                      onChange={e => setDbAlias(e.target.value)} 
                      placeholder="z. B. kiSystem Hauptdatenbank" 
                      className="input-field" 
                      required 
                    />
                  </div>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Typ *</label>
                      <select 
                        value={dbType} 
                        onChange={e => {
                          setDbType(e.target.value as "postgres" | "mongodb");
                          setDbPort(e.target.value === "postgres" ? 5432 : 27017);
                        }} 
                        className={styles.selectField}
                      >
                        <option value="postgres">PostgreSQL</option>
                        <option value="mongodb">MongoDB</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label className="input-label">Host *</label>
                      <input 
                        type="text" 
                        value={dbHost} 
                        onChange={e => setDbHost(e.target.value)} 
                        className="input-field" 
                        required 
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Port *</label>
                      <input 
                        type="number" 
                        value={dbPort} 
                        onChange={e => setDbPort(Number(e.target.value))} 
                        className="input-field" 
                        required 
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Datenbankname *</label>
                      <input 
                        type="text" 
                        value={dbDatabase} 
                        onChange={e => setDbDatabase(e.target.value)} 
                        placeholder="z. B. dbname" 
                        className="input-field" 
                        required 
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Benutzername</label>
                      <input 
                        type="text" 
                        value={dbUser} 
                        onChange={e => setDbUser(e.target.value)} 
                        placeholder="z. B. postgres" 
                        className="input-field" 
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Passwort</label>
                      <input 
                        type="password" 
                        value={dbPassword} 
                        onChange={e => setDbPassword(e.target.value)} 
                        placeholder="••••••••" 
                        className="input-field" 
                      />
                    </div>
                  </div>

                  {dbType === "postgres" && (
                    <div className="input-group">
                      <label className="input-label">Schema</label>
                      <input 
                        type="text" 
                        value={dbSchema} 
                        onChange={e => setDbSchema(e.target.value)} 
                        className="input-field" 
                      />
                    </div>
                  )}

                  <div className={styles.formActions}>
                    {editingDbId && (
                      <button 
                        type="button" 
                        onClick={() => {
                          setEditingDbId(null);
                          setDbAlias("");
                          setDbDatabase("");
                          setDbUser("");
                          setDbPassword("");
                          setDbType("postgres");
                          setDbHost("localhost");
                          setDbPort(5432);
                          setDbSchema("public");
                        }} 
                        className="btn btn-secondary"
                      >
                        Abbrechen
                      </button>
                    )}
                    <button type="submit" className="btn btn-primary">
                      Speichern
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleProvisionDatabase} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.25rem" }}>
                    1. Server-Verbindung (Admin)
                  </h4>
                  
                  <div className="input-group">
                    <label className="input-label">Verbindungsvorlage</label>
                    <select 
                      value={selectedAdminDbId} 
                      onChange={e => handleAdminDbTemplateChange(e.target.value)} 
                      className={styles.selectField}
                    >
                      <option value="custom">Eigene Serverdaten eingeben...</option>
                      <option value="postgres-default">Standard lokales PostgreSQL (localhost:5432)</option>
                      <option value="mongodb-default">Standard lokales MongoDB (localhost:27017)</option>
                      {registeredDbs.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.alias} ({d.user}@{d.host}:{d.port})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Server-Typ *</label>
                      <select 
                        value={adminDbType} 
                        onChange={e => {
                          setAdminDbType(e.target.value as "postgres" | "mongodb");
                          setAdminPort(e.target.value === "postgres" ? 5432 : 27017);
                        }} 
                        className={styles.selectField}
                        disabled={selectedAdminDbId !== "custom"}
                      >
                        <option value="postgres">PostgreSQL</option>
                        <option value="mongodb">MongoDB</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label className="input-label">Server Host *</label>
                      <input 
                        type="text" 
                        value={adminHost} 
                        onChange={e => setAdminHost(e.target.value)} 
                        className="input-field" 
                        required 
                        disabled={selectedAdminDbId !== "custom"}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Server Port *</label>
                      <input 
                        type="number" 
                        value={adminPort} 
                        onChange={e => setAdminPort(Number(e.target.value))} 
                        className="input-field" 
                        required 
                        disabled={selectedAdminDbId !== "custom"}
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Admin-Datenbank *</label>
                      <input 
                        type="text" 
                        value={adminDatabase} 
                        onChange={e => setAdminDatabase(e.target.value)} 
                        placeholder={adminDbType === "postgres" ? "postgres" : "admin"}
                        className="input-field" 
                        required 
                        disabled={selectedAdminDbId !== "custom"}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Admin-Nutzername</label>
                      <input 
                        type="text" 
                        value={adminUser} 
                        onChange={e => setAdminUser(e.target.value)} 
                        placeholder={adminDbType === "postgres" ? "postgres" : "admin"} 
                        className="input-field"
                        disabled={selectedAdminDbId !== "custom"}
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Admin-Passwort</label>
                      <input 
                        type="password" 
                        value={adminPassword} 
                        onChange={e => setAdminPassword(e.target.value)} 
                        placeholder="••••••••" 
                        className="input-field"
                        disabled={selectedAdminDbId !== "custom"}
                      />
                    </div>
                  </div>

                  <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-glass)", paddingBottom: "0.25rem", marginTop: "1rem" }}>
                    2. Neue Datenbank & Benutzer
                  </h4>

                  <div className="input-group">
                    <label className="input-label">Aliasname für Eintrag *</label>
                    <input 
                      type="text" 
                      value={dbAlias} 
                      onChange={e => setDbAlias(e.target.value)} 
                      placeholder="z. B. kiSystem Hauptdatenbank" 
                      className="input-field" 
                      required 
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Datenbankname *</label>
                      <input 
                        type="text" 
                        value={dbDatabase} 
                        onChange={e => setDbDatabase(e.target.value)} 
                        placeholder="z. B. kisystem" 
                        className="input-field" 
                        required 
                      />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Neuer Benutzername *</label>
                      <input 
                        type="text" 
                        value={dbUser} 
                        onChange={e => setDbUser(e.target.value)} 
                        placeholder="z. B. app_user" 
                        className="input-field" 
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="input-group">
                      <label className="input-label">Passwort für Benutzer *</label>
                      <input 
                        type="password" 
                        value={dbPassword} 
                        onChange={e => setDbPassword(e.target.value)} 
                        placeholder="••••••••" 
                        className="input-field" 
                        required
                      />
                    </div>
                    {adminDbType === "postgres" && (
                      <div className="input-group">
                        <label className="input-label">Schema</label>
                        <input 
                          type="text" 
                          value={dbSchema} 
                          onChange={e => setDbSchema(e.target.value)} 
                          className="input-field" 
                        />
                      </div>
                    )}
                  </div>

                  <div className={styles.formActions} style={{ marginTop: "1rem" }}>
                    <button 
                      type="submit" 
                      className="btn btn-primary"
                      disabled={isProvisioningLoading}
                    >
                      {isProvisioningLoading ? (
                        <>
                          <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                          <span>Erstellt...</span>
                        </>
                      ) : (
                        <span>Datenbank erstellen</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Database List Card */}
            <div className={`${styles.settingsCard} glass-panel`}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Registrierte Datenbanken</h3>
              {isResourcesLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                </div>
              ) : registeredDbs.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Keine Datenbanken registriert.</p>
              ) : (
                <div className={styles.resourceList}>
                  {registeredDbs.map(db => (
                    <div key={db.id} className={styles.resourceItem}>
                      <div className={styles.resourceDetails}>
                        <span className={styles.resourceAlias}>{db.alias}</span>
                        <span className={styles.resourceSub}>
                          {db.type.toUpperCase()} &bull; {db.user || "default"}@{db.host}:{db.port}/{db.database}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {db.type === "postgres" && (
                          <button 
                            onClick={() => {
                              setSelectedDbForBackups(db);
                              fetchBackups(db.id);
                            }} 
                            className="btn btn-secondary btn-icon" 
                            style={{ width: "30px", height: "30px" }} 
                            title="Backups verwalten"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                              <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                            </svg>
                          </button>
                        )}
                        <button onClick={() => startEditDb(db)} className="btn btn-secondary btn-icon" style={{ width: "30px", height: "30px" }} title="Bearbeiten">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button onClick={() => handleDeleteDatabase(db.id)} className="btn btn-secondary btn-icon" style={{ width: "30px", height: "30px" }} title="Löschen">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Gefundene Datenbanken (Auto-Discovery) */}
          {(() => {
            const unregisteredDbs = databases.filter(d => !isAlreadyRegistered(d));
            return (
              <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "3rem", animation: "fadeIn 0.3s ease-out" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="pulse-dot pulse-dot-online"></span>
                  Gefundene Datenbanken auf diesem PC (Auto-Discovery)
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
                  Diese Datenbanken wurden automatisch im lokalen System oder in Projektkonfigurationen (.env) gefunden, sind aber noch nicht im ProcessManager registriert.
                </p>

                {isDbsLoading ? (
                  <div style={{ textAlign: "center", padding: "1.5rem" }}>
                    <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                    <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>Scanne System...</span>
                  </div>
                ) : unregisteredDbs.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.9rem" }}>
                    Keine nicht-registrierten Datenbanken im System gefunden.
                  </p>
                ) : (
                  <div className={styles.resourceList}>
                    {unregisteredDbs.map((db, idx) => (
                      <div key={`disc-${idx}`} className={styles.resourceItem} style={{ borderLeft: "3px solid var(--primary)" }}>
                        <div className={styles.resourceDetails}>
                          <span className={styles.resourceAlias} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {db.name}
                            <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                              {db.type === "postgres" ? "PostgreSQL" : "MongoDB"}
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              (erkannt in: {db.sourceProcess})
                            </span>
                          </span>
                          <span className={styles.resourceSub}>
                            Host: {db.host} &bull; Benutzer: {db.user || "default"} {db.status === "offline" && <span style={{ color: "var(--danger)" }}> &bull; Offline ({db.error || "Port geschlossen"})</span>}
                          </span>
                        </div>
                        <div>
                          <button 
                            type="button"
                            onClick={() => handleRegisterDiscovered(db)} 
                            className="btn btn-secondary" 
                            style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                          >
                            Registrieren
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Tab: Keys & Ports Manager */}
      {activeTab === "keys" && (
        <div className="layout-main" style={{ animation: "fadeIn 0.3s ease-out" }}>
          {/* Google Keys Section */}
          <h2 className={styles.sectionTitle} style={{ marginBottom: "1rem" }}>Zentrale Google API Keys</h2>
          <div className={styles.settingsGrid} style={{ marginBottom: "3rem" }}>
            {/* Google Key Form Card */}
            <div className={`${styles.settingsCard} glass-panel`}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {editingGoogleId ? "Google API Key bearbeiten" : "Google API Key registrieren"}
              </h3>
              <form onSubmit={handleSaveGoogleKey} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="input-group">
                  <label className="input-label">Aliasname *</label>
                  <input 
                    type="text" 
                    value={googleAlias} 
                    onChange={e => setGoogleAlias(e.target.value)} 
                    placeholder="z. B. Google AI Production" 
                    className="input-field" 
                    required 
                  />
                </div>
                
                <div className="input-group">
                  <label className="input-label">Key *</label>
                  {!googleKeyCustomMode ? (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <select 
                        value={googleKeyName} 
                        onChange={e => {
                          if (e.target.value === "custom") {
                            setGoogleKeyCustomMode(true);
                          } else {
                            setGoogleKeyName(e.target.value);
                          }
                        }}
                        className={styles.selectField}
                        style={{ flex: 1 }}
                      >
                        <option value="GOOGLE_API_KEY">GOOGLE_API_KEY</option>
                        <option value="custom">Anderer Google Key Name...</option>
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input 
                        type="text" 
                        value={customGoogleKey} 
                        onChange={e => setCustomGoogleKey(e.target.value)} 
                        placeholder="z. B. GOOGLE_CLIENT_ID" 
                        className="input-field" 
                        style={{ flex: 1 }}
                        required 
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          setGoogleKeyCustomMode(false);
                          setGoogleKeyName("GOOGLE_API_KEY");
                        }} 
                        className="btn btn-secondary"
                        style={{ padding: "0 0.75rem" }}
                      >
                        Standard
                      </button>
                    </div>
                  )}
                  <span className={styles.helperText}>Dieser Key wird beim Generieren der .env-Datei verwendet.</span>
                </div>

                <div className="input-group">
                  <label className="input-label">Wert *</label>
                  <input 
                    type="text" 
                    value={googleValue} 
                    onChange={e => setGoogleValue(e.target.value)} 
                    placeholder="Geheimer Key-Wert" 
                    className="input-field" 
                    required 
                  />
                </div>

                <div className={styles.formActions}>
                  {editingGoogleId && (
                    <button 
                      type="button" 
                      onClick={() => {
                        setEditingGoogleId(null);
                        setGoogleAlias("");
                        setGoogleValue("");
                        setCustomGoogleKey("");
                        setGoogleKeyCustomMode(false);
                        setGoogleKeyName("GOOGLE_API_KEY");
                      }} 
                      className="btn btn-secondary"
                    >
                      Abbrechen
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary">
                    Speichern
                  </button>
                </div>
              </form>
            </div>

            {/* Google Key List Card */}
            <div className={`${styles.settingsCard} glass-panel`}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Registrierte Google Keys</h3>
              {isResourcesLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                </div>
              ) : googleCreds.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Keine Google API Keys registriert.</p>
              ) : (
                <div className={styles.resourceList}>
                  {googleCreds.map(cred => (
                    <div key={cred.id} className={styles.resourceItem}>
                      <div className={styles.resourceDetails}>
                        <span className={styles.resourceAlias}>{cred.alias}</span>
                        <span className={styles.resourceSub}>
                          {cred.key} = {cred.value.length > 25 ? cred.value.substring(0, 25) + "..." : cred.value}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button 
                          onClick={() => {
                            setEditingGoogleId(cred.id);
                            setGoogleAlias(cred.alias);
                            setGoogleValue(cred.value);
                            if (cred.key === "GOOGLE_API_KEY") {
                              setGoogleKeyName("GOOGLE_API_KEY");
                              setGoogleKeyCustomMode(false);
                            } else {
                              setGoogleKeyName("custom");
                              setCustomGoogleKey(cred.key);
                              setGoogleKeyCustomMode(true);
                            }
                          }} 
                          className="btn btn-secondary btn-icon" 
                          style={{ width: "30px", height: "30px" }} 
                          title="Bearbeiten"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button onClick={() => handleDeleteCredential(cred.id)} className="btn btn-secondary btn-icon" style={{ width: "30px", height: "30px" }} title="Löschen">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Ports Section */}
          <h2 className={styles.sectionTitle} style={{ marginBottom: "1rem" }}>System Ports</h2>
          <div className={styles.settingsGrid}>
            {/* Ports Form Card */}
            <div className={`${styles.settingsCard} glass-panel`}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {editingPortId ? "Port bearbeiten" : "Port registrieren"}
              </h3>
              <form onSubmit={handleSavePort} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="input-group">
                  <label className="input-label">Aliasname *</label>
                  <input 
                    type="text" 
                    value={portAlias} 
                    onChange={e => setPortAlias(e.target.value)} 
                    placeholder="z. B. kiSystem Port" 
                    className="input-field" 
                    required 
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">Key *</label>
                  <input 
                    type="text" 
                    value={portKeyName} 
                    onChange={e => setPortKeyName(e.target.value)} 
                    placeholder="PORT" 
                    className="input-field" 
                    required 
                  />
                  <span className={styles.helperText}>Wird meistens &apos;PORT&apos; genannt.</span>
                </div>

                <div className="input-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>Port Wert *</label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                      <input 
                        type="checkbox" 
                        checked={portCustomMode} 
                        onChange={e => setPortCustomMode(e.target.checked)} 
                      />
                      Eigene Portnummer eingeben
                    </label>
                  </div>
                  
                  {!portCustomMode ? (
                    <select 
                      value={selectedPort} 
                      onChange={e => {
                        setSelectedPort(e.target.value);
                        if (!portAlias && e.target.value) {
                          setPortAlias(`Port ${e.target.value}`);
                        }
                      }} 
                      className={styles.selectField}
                      required
                    >
                      <option value="">-- Port auswählen --</option>
                      {scannedPorts.map(p => {
                        let statusText = "Frei";
                        if (p.inUse) {
                          statusText = p.projectName ? `Belegt (PM2: ${p.projectName})` : "Belegt (Aktiv)";
                        } else if (p.registered) {
                          statusText = p.projectName ? `Registriert (${p.projectName})` : "Registriert";
                        }
                        
                        return (
                          <option key={p.port} value={p.port}>
                            Port {p.port} ({statusText})
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input 
                      type="number" 
                      value={customPortValue} 
                      onChange={e => setCustomPortValue(e.target.value)} 
                      placeholder="z. B. 3001" 
                      className="input-field" 
                      required 
                    />
                  )}
                </div>

                <div className={styles.formActions}>
                  {editingPortId && (
                    <button 
                      type="button" 
                      onClick={() => {
                        setEditingPortId(null);
                        setPortAlias("");
                        setSelectedPort("");
                        setCustomPortValue("");
                        setPortCustomMode(false);
                      }} 
                      className="btn btn-secondary"
                    >
                      Abbrechen
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={isPortsLoading}>
                    Speichern
                  </button>
                </div>
              </form>
            </div>

            {/* Ports List Card */}
            <div className={`${styles.settingsCard} glass-panel`}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Registrierte System Ports</h3>
              {isResourcesLoading || isPortsLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                </div>
              ) : portCreds.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Keine Ports registriert.</p>
              ) : (
                <div className={styles.resourceList}>
                  {portCreds.map(cred => {
                    const portNum = parseInt(cred.value, 10);
                    const matchingScan = scannedPorts.find(p => p.port === portNum);
                    const isOnline = matchingScan ? matchingScan.inUse : false;

                    return (
                      <div key={cred.id} className={styles.resourceItem} style={{ borderLeft: isOnline ? "3px solid var(--success, #10b981)" : "3px solid var(--text-muted)" }}>
                        <div className={styles.resourceDetails}>
                          <span className={styles.resourceAlias} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            {cred.alias}
                            <span style={{ 
                              fontSize: "0.75rem", 
                              padding: "0.05rem 0.4rem", 
                              borderRadius: "4px", 
                              background: isOnline ? "rgba(16, 185, 129, 0.15)" : "rgba(255,255,255,0.06)", 
                              color: isOnline ? "var(--success, #10b981)" : "var(--text-secondary)" 
                            }}>
                              {isOnline ? "Aktiv/Listening" : "Inaktiv/Geschlossen"}
                            </span>
                          </span>
                          <span className={styles.resourceSub}>
                            {cred.key} = {cred.value}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button 
                            onClick={() => {
                              setEditingPortId(cred.id);
                              setPortAlias(cred.alias);
                              setPortKeyName(cred.key);
                              
                              const numStr = cred.value;
                              const hasInScanned = scannedPorts.some(p => String(p.port) === numStr);
                              if (hasInScanned) {
                                setSelectedPort(numStr);
                                setPortCustomMode(false);
                              } else {
                                setCustomPortValue(numStr);
                                setPortCustomMode(true);
                              }
                            }} 
                            className="btn btn-secondary btn-icon" 
                            style={{ width: "30px", height: "30px" }} 
                            title="Bearbeiten"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button onClick={() => handleDeleteCredential(cred.id)} className="btn btn-secondary btn-icon" style={{ width: "30px", height: "30px" }} title="Löschen">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Project Linker */}
      {activeTab === "projects" && (
        <div className="layout-main" style={{ animation: "fadeIn 0.3s ease-out" }}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Projekte</h2>
          </div>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "2rem" }}>
            Projekte mit einer <code>process-manager.json</code> Datei im Hauptverzeichnis werden hier aufgelistet.
            Ordne deren benötigten Umgebungsvariablen den zentral registrierten Datenbanken oder Zugangsdaten zu.
          </p>

          {isProjectsLoading ? (
            <div className="glass-panel" style={{ padding: "4rem", textAlign: "center" }}>
              <svg className="spinner" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="40 20"></circle></svg>
              <p style={{ marginTop: "1rem", color: "var(--text-secondary)" }}>Projekte werden gescannt...</p>
            </div>
          ) : discoveredProjects.length === 0 ? (
            <div className="glass-panel" style={{ padding: "4rem", textAlign: "center" }}>
              <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>Keine verwalteten Projekte mit Deklarationsdatei gefunden.</p>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", maxWidth: "550px", margin: "1rem auto 0 auto" }}>
                Erstelle im Hauptverzeichnis deiner Nachbarprojekte eine Datei namens <code>process-manager.json</code> mit der Liste aller Umgebungsvariablen, die das Projekt benötigt.
              </p>
            </div>
          ) : (
            discoveredProjects.map(proj => {
              const isSaving = isSavingProject[proj.name];
              return (
                <div key={proj.name} className={`${styles.projectCard} glass-panel`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
                    <div>
                      <h3 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#fff" }}>{proj.name}</h3>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "0.25rem" }}>
                        {proj.path}
                      </p>
                    </div>
                    <button 
                      onClick={() => handleApplyProject(proj.name)}
                      disabled={isSaving}
                      className="btn btn-primary"
                    >
                      {isSaving ? (
                        <>
                          <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                          <span>Wird angewendet...</span>
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                          <span>Speichern & Anwenden</span>
                        </>
                      )}
                    </button>
                  </div>

                  <table className={styles.mappingTable}>
                    <thead>
                      <tr>
                        <th style={{ width: "25%" }}>Umgebungsvariable</th>
                        <th style={{ width: "35%" }}>Beschreibung</th>
                        <th style={{ width: "40%" }}>Zugeordnete Ressource</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proj.requirements.map(req => {
                        const currentVal = (pendingLinks[proj.name] || {})[req.key] || "";
                        return (
                          <tr key={req.key}>
                            <td>
                              <span className={styles.mappingKey}>{req.key}</span>
                            </td>
                            <td>
                              <span className={styles.mappingDesc}>{req.description || "Keine Beschreibung hinterlegt"}</span>
                            </td>
                            <td>
                              <select 
                                value={currentVal}
                                onChange={e => handleLinkChange(proj.name, req.key, e.target.value)}
                                className={styles.selectField}
                              >
                                <option value="">-- Nicht verknüpft (Leerwert) --</option>
                                {req.type === "database" ? (
                                  <optgroup label="Datenbanken (Postgres & MongoDB)">
                                    {registeredDbs
                                      .filter(db => !req.dbType || db.type === req.dbType)
                                      .map(db => (
                                        <option key={db.id} value={db.id}>
                                          {db.alias} ({db.type})
                                        </option>
                                      ))
                                    }
                                  </optgroup>
                                ) : (
                                  <>
                                    {req.key.toUpperCase().includes("PORT") ? (
                                      <optgroup label="System Ports">
                                        {registeredCreds
                                          .filter(cred => cred.type === "port" || cred.key === "PORT" || cred.key.includes("PORT"))
                                          .map(cred => (
                                            <option key={cred.id} value={cred.id}>
                                              {cred.alias} ({cred.value})
                                            </option>
                                          ))
                                        }
                                      </optgroup>
                                    ) : (
                                      <optgroup label="Google API & AI Keys">
                                        {registeredCreds
                                          .filter(cred => !(cred.type === "port" || cred.key === "PORT" || cred.key.includes("PORT")))
                                          .map(cred => (
                                            <option key={cred.id} value={cred.id}>
                                              {cred.alias} ({cred.key})
                                            </option>
                                          ))
                                        }
                                      </optgroup>
                                    )}
                                  </>
                                )}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {proj.hasPrisma && (
                    <div style={{ borderTop: "1px solid var(--border-glass)", marginTop: "1.5rem", paddingTop: "1.5rem" }}>
                      <h4 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#fff", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                        </svg>
                        Datenbank-Migrationen & Tools (Prisma)
                      </h4>

                      {!proj.hasMigrations ? (
                        <div style={{ background: "rgba(245, 158, 11, 0.08)", borderLeft: "3px solid var(--warning)", padding: "0.85rem 1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                          <strong style={{ color: "var(--warning)" }}>Achtung:</strong> Keine Migrationshistorie im Projekt vorhanden. 
                          Um Datenverlust zu vermeiden, kannst du deine Migrationshistorie initialisieren (Baselining) oder das Schema direkt synchronisieren (db push).
                          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
                            <button 
                              onClick={() => handlePrismaAction(proj.name, "prisma-baseline")}
                              disabled={isMigrationRunning[proj.name]}
                              className="btn btn-primary"
                              style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                            >
                              Migrationshistorie initialisieren (Baselining - Daten behalten)
                            </button>
                            <button 
                              onClick={() => handlePrismaAction(proj.name, "prisma-push")}
                              disabled={isMigrationRunning[proj.name]}
                              className="btn btn-secondary"
                              style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                            >
                              Schema direkt einspielen (db push)
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                          <button 
                            onClick={() => handlePrismaAction(proj.name, "prisma-status")}
                            disabled={isMigrationRunning[proj.name]}
                            className="btn btn-secondary"
                            style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                          >
                            Status prüfen (migrate status)
                          </button>
                          <button 
                            onClick={() => handlePrismaAction(proj.name, "prisma-push")}
                            disabled={isMigrationRunning[proj.name]}
                            className="btn btn-secondary"
                            style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                          >
                            Push (db push)
                          </button>
                          <button 
                            onClick={() => handlePrismaAction(proj.name, "prisma-generate")}
                            disabled={isMigrationRunning[proj.name]}
                            className="btn btn-secondary"
                            style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                          >
                            Client generieren
                          </button>
                        </div>
                      )}

                      {proj.hasMigrations && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "1rem" }}>
                          <input 
                            type="text"
                            placeholder="z. B. add_fuzzy_time"
                            value={newMigrationName[proj.name] || ""}
                            onChange={e => setNewMigrationName(prev => ({ ...prev, [proj.name]: e.target.value }))}
                            className="input-field"
                            style={{ maxWidth: "250px", padding: "0.4rem 0.75rem", fontSize: "0.85rem" }}
                          />
                          <button 
                            onClick={() => {
                              const name = newMigrationName[proj.name];
                              if (!name) {
                                alert("Bitte gib einen Namen für die Migration ein.");
                                return;
                              }
                              handlePrismaAction(proj.name, "prisma-migrate", { migrationName: name });
                              setNewMigrationName(prev => ({ ...prev, [proj.name]: "" }));
                            }}
                            disabled={isMigrationRunning[proj.name]}
                            className="btn btn-primary"
                            style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                          >
                            Migration erstellen & anwenden
                          </button>
                        </div>
                      )}

                      {activeProjectForLogs === proj.name && (
                        <div style={{ marginTop: "1.25rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 500 }}>Terminal-Ausgabe:</span>
                            <button 
                              onClick={() => {
                                setActiveProjectForLogs(null);
                                setMigrationLogs("");
                              }}
                              className="btn btn-secondary"
                              style={{ padding: "0.2rem 0.4rem", fontSize: "0.7rem", height: "auto" }}
                            >
                              Schließen
                            </button>
                          </div>
                          <pre style={{
                            background: "#040507",
                            border: "1px solid var(--border-glass)",
                            borderRadius: "6px",
                            padding: "0.75rem 1rem",
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.8rem",
                            color: "#10b981",
                            overflowX: "auto",
                            whiteSpace: "pre-wrap",
                            maxHeight: "250px",
                            overflowY: "auto"
                          }}>
                            {migrationLogs}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
      {/* Backup Management Modal */}
      {selectedDbForBackups && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          animation: "fadeIn 0.2s ease-out"
        }}>
          <div className="glass-panel" style={{
            width: "90%",
            maxWidth: "600px",
            padding: "2rem",
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-glass)", paddingBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#fff" }}>Backups für: {selectedDbForBackups.alias}</h3>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Datenbank: {selectedDbForBackups.database}</span>
              </div>
              <button 
                onClick={() => setSelectedDbForBackups(null)} 
                className="btn btn-secondary btn-icon" 
                style={{ width: "30px", height: "30px", borderRadius: "50%" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>Manuelle Backups:</span>
              <button 
                onClick={() => handleCreateBackup(selectedDbForBackups.id)}
                disabled={isBackupCreating}
                className="btn btn-primary"
                style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
              >
                {isBackupCreating ? (
                  <>
                    <svg className="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                    <span>Erstelle Backup...</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Neues Backup erstellen</span>
                  </>
                )}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: "150px", maxHeight: "300px" }}>
              {isBackupLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="30 15"></circle></svg>
                </div>
              ) : backups.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontStyle: "italic", textAlign: "center", paddingTop: "2rem" }}>
                  Keine Backups für diese Datenbank gefunden.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {backups.map(b => (
                    <div key={b.filename} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem 1rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--border-glass)",
                      borderRadius: "8px"
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxWidth: "70%" }}>
                        <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.filename}>
                          {b.filename}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                          {new Date(b.createdAt).toLocaleString("de-DE")} &bull; {(b.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button 
                          onClick={() => handleRestoreBackup(selectedDbForBackups.id, b.filename)}
                          className="btn btn-secondary"
                          style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem", color: "var(--warning)" }}
                          title="Wiederherstellen"
                        >
                          Restore
                        </button>
                        <button 
                          onClick={() => handleDeleteBackup(selectedDbForBackups.id, b.filename)}
                          className="btn btn-secondary btn-icon"
                          style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          title="Löschen"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--border-glass)", paddingTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedDbForBackups(null)} className="btn btn-secondary" style={{ padding: "0.5rem 1rem" }}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
