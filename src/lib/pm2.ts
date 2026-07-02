import pm2 from "pm2";
import fs from "fs";

export interface ProcessInfo {
  id: number;
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number; // in bytes
  uptime: number; // in ms
  restarts: number;
  outLogPath?: string;
  errLogPath?: string;
}

// Mock database for local testing when PM2 is not available
let mockProcesses: ProcessInfo[] = [
  {
    id: 0,
    name: "api-server",
    pid: 10423,
    status: "online",
    cpu: 1.2,
    memory: 45 * 1024 * 1024,
    uptime: Date.now() - 3600000 * 4, // 4 hours ago
    restarts: 2,
  },
  {
    id: 1,
    name: "frontend-web",
    pid: 10424,
    status: "online",
    cpu: 0.5,
    memory: 68 * 1024 * 1024,
    uptime: Date.now() - 3600000 * 2, // 2 hours ago
    restarts: 0,
  },
  {
    id: 2,
    name: "discord-bot",
    pid: 10567,
    status: "stopped",
    cpu: 0,
    memory: 0,
    uptime: 0,
    restarts: 12,
  },
  {
    id: 3,
    name: "database-sync",
    pid: 0,
    status: "errored",
    cpu: 0,
    memory: 0,
    uptime: 0,
    restarts: 5,
  },
];

// Mock log cache
const mockLogs: Record<string, string[]> = {
  "api-server": [
    "[MOCK] [2026-06-24 00:01:00] api-server starting...",
    "[MOCK] [2026-06-24 00:01:02] Connected to database: postgres://localhost:5432/main",
    "[MOCK] [2026-06-24 00:01:03] Server listening on port 4000 in development mode",
    "[MOCK] [2026-06-24 00:10:45] GET /api/v1/auth/status - 200 OK - 8ms",
    "[MOCK] [2026-06-24 00:12:12] GET /api/v1/processes - 200 OK - 15ms",
    "[MOCK] [2026-06-24 00:15:30] POST /api/v1/auth/login - 200 OK - 120ms",
  ],
  "frontend-web": [
    "[MOCK] [2026-06-24 02:00:00] frontend-web starting...",
    "[MOCK] [2026-06-24 02:00:02] Next.js server started on http://localhost:3000",
    "[MOCK] [2026-06-24 02:05:00] GET /login - 200 OK",
    "[MOCK] [2026-06-24 02:05:10] GET /_next/static/chunks/main.js - 200 OK",
    "[MOCK] [2026-06-24 02:05:22] GET /dashboard - 200 OK",
  ],
  "discord-bot": [
    "[MOCK] [2026-06-23 20:00:00] discord-bot offline. Stop command received.",
  ],
  "database-sync": [
    "[MOCK] [2026-06-24 00:00:00] database-sync starting...",
    "[MOCK] [2026-06-24 00:00:01] Error: Connection lost to remote database cluster sync-0.db.example.com",
    "[MOCK] [2026-06-24 00:00:01] Process exited with code 1. PM2 will restart soon.",
  ],
};

let isMockMode = false;
let pm2Checked = false;

// Attempt to connect to PM2
function connectPm2(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect(true, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function checkPm2Available(): Promise<boolean> {
  if (isMockMode) return false;
  if (pm2Checked) return true;
  try {
    await connectPm2();
    pm2.disconnect();
    pm2Checked = true;
    return true;
  } catch (error) {
    console.warn("Could not connect to PM2. Falling back to Mock Mode.", error);
    isMockMode = true;
    return false;
  }
}

// Queue to serialize all PM2 connection operations and prevent sock/null conflicts
let pm2Queue = Promise.resolve();

function runPm2<T>(action: () => Promise<T>): Promise<T> {
  const result = pm2Queue.then(async () => {
    await connectPm2();
    try {
      return await action();
    } finally {
      pm2.disconnect();
    }
  });
  // Chain resolved/rejected promise to release the queue
  pm2Queue = result.then(() => {}, () => {});
  return result;
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const pm2Available = await checkPm2Available();

  if (!pm2Available) {
    // Return mock data, but dynamically update cpu and memory slightly for realistic dashboard updates
    return mockProcesses.map((p) => {
      if (p.status === "online") {
        return {
          ...p,
          cpu: Math.max(0.1, Number((p.cpu + (Math.random() - 0.5) * 0.4).toFixed(1))),
          memory: Math.max(
            10 * 1024 * 1024,
            p.memory + Math.round((Math.random() - 0.5) * 500000)
          ),
        };
      }
      return p;
    });
  }

  return runPm2(() => new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) {
        return reject(err);
      }

      const processes = list.map((p) => {
        const uptime = p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;
        return {
          id: p.pm_id ?? -1,
          name: p.name ?? "unknown",
          pid: p.pid ?? 0,
          status: p.pm2_env?.status ?? "unknown",
          cpu: p.monit?.cpu ?? 0,
          memory: p.monit?.memory ?? 0,
          uptime: p.pm2_env?.status === "online" ? uptime : 0,
          restarts: p.pm2_env?.restart_time ?? 0,
          outLogPath: p.pm2_env?.pm_out_log_path,
          errLogPath: p.pm2_env?.pm_err_log_path,
        };
      });

      resolve(processes);
    });
  }));
}

export async function stopProcess(nameOrId: string | number): Promise<boolean> {
  const pm2Available = await checkPm2Available();

  if (!pm2Available) {
    mockProcesses = mockProcesses.map((p) => {
      if (p.name === nameOrId || p.id === Number(nameOrId)) {
        const name = p.name;
        if (mockLogs[name]) {
          mockLogs[name].push(`[MOCK] [${new Date().toISOString().replace('T', ' ').substring(0, 19)}] Process stopped via Dashboard`);
        }
        return {
          ...p,
          status: "stopped",
          cpu: 0,
          memory: 0,
          uptime: 0,
        };
      }
      return p;
    });
    return true;
  }

  return runPm2(() => new Promise((resolve) => {
    pm2.stop(nameOrId, (err) => {
      if (err) {
        console.error(`Failed to stop process ${nameOrId}:`, err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }));
}

export async function startProcess(nameOrId: string | number): Promise<boolean> {
  const pm2Available = await checkPm2Available();

  if (!pm2Available) {
    mockProcesses = mockProcesses.map((p) => {
      if (p.name === nameOrId || p.id === Number(nameOrId)) {
        const name = p.name;
        if (mockLogs[name]) {
          mockLogs[name].push(`[MOCK] [${new Date().toISOString().replace('T', ' ').substring(0, 19)}] Process started via Dashboard`);
        }
        return {
          ...p,
          status: "online",
          cpu: 1.0,
          memory: 32 * 1024 * 1024,
          uptime: Date.now(),
        };
      }
      return p;
    });
    return true;
  }

  return runPm2(() => new Promise((resolve) => {
    pm2.start(nameOrId as string, (err) => {
      if (err) {
        console.error(`Failed to start process ${nameOrId}:`, err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }));
}

export async function restartProcess(nameOrId: string | number): Promise<boolean> {
  const pm2Available = await checkPm2Available();

  if (!pm2Available) {
    mockProcesses = mockProcesses.map((p) => {
      if (p.name === nameOrId || p.id === Number(nameOrId)) {
        const name = p.name;
        if (mockLogs[name]) {
          mockLogs[name].push(`[MOCK] [${new Date().toISOString().replace('T', ' ').substring(0, 19)}] Process restarted via Dashboard`);
        }
        return {
          ...p,
          status: "online",
          cpu: 2.5,
          memory: 40 * 1024 * 1024,
          uptime: Date.now(),
          restarts: p.restarts + 1,
        };
      }
      return p;
    });
    return true;
  }

  return runPm2(() => new Promise((resolve) => {
    // Pass { updateEnv: true } to tell PM2 to update cached environment variables from the environment
    // We cast to any to bypass incomplete TypeScript typings for the 3-argument signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pm2 as any).restart(nameOrId, { updateEnv: true }, (err: any) => {
      if (err) {
        console.error(`Failed to restart process ${nameOrId}:`, err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  }));
}

export async function getProcessLogs(nameOrId: string | number, maxLines: number = 100): Promise<string[]> {
  const pm2Available = await checkPm2Available();

  if (!pm2Available) {
    // Find mock process name
    const p = mockProcesses.find((proc) => proc.name === nameOrId || proc.id === Number(nameOrId));
    if (p && mockLogs[p.name]) {
      return mockLogs[p.name].slice(-maxLines);
    }
    return ["[MOCK] No logs available for this mock process."];
  }

  return runPm2(() => new Promise((resolve) => {
    pm2.describe(nameOrId, (err, desc) => {
      if (err || !desc || desc.length === 0) {
        return resolve([`Failed to find process descriptions or logs for ${nameOrId}`]);
      }

      const pInfo = desc[0];
      const outLog = pInfo.pm2_env?.pm_out_log_path;
      const errLog = pInfo.pm2_env?.pm_err_log_path;

      const logLines: string[] = [];

      try {
        if (outLog && fs.existsSync(outLog)) {
          const content = fs.readFileSync(outLog, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim() !== "");
          logLines.push(...lines.slice(-maxLines).map(l => `[STDOUT] ${l}`));
        }
        if (errLog && fs.existsSync(errLog)) {
          const content = fs.readFileSync(errLog, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim() !== "");
          logLines.push(...lines.slice(-maxLines).map(l => `[STDERR] ${l}`));
        }

        if (logLines.length === 0) {
          return resolve(["No logs available or log files are empty."]);
        }

        // Sort logs or return them. Since PM2 logs are usually written concurrently,
        // we will return them sorted or simply the stdout/stderr appended.
        // Let's sort them if they have timestamps or keep them as is. Let's just return the last maxLines.
        resolve(logLines.slice(-maxLines));
      } catch (fsErr) {
        console.error("Error reading log files:", fsErr);
        resolve([`Error reading log files from filesystem: ${fsErr instanceof Error ? fsErr.message : fsErr}`]);
      }
    });
  }));
}
