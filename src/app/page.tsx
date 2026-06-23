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

export default function DashboardPage() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});
  
  const router = useRouter();
  const consoleRef = useRef<HTMLDivElement>(null);

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

  // Fetch user session info
  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth");
      if (response.ok) {
        const data = await response.json();
        setUserEmail(data.email || "Admin");
      }
    } catch (error) {
      console.error("Error fetching session:", error);
    }
  }, []);

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

  // Setup polling intervals
  useEffect(() => {
    const initializeDashboard = async () => {
      await fetchSession();
      await fetchProcesses(true);
    };
    initializeDashboard();

    const processInterval = setInterval(() => {
      fetchProcesses(false);
    }, 3000);

    return () => clearInterval(processInterval);
  }, [fetchSession, fetchProcesses]);

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

  // Stats calculations
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

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={`${styles.title} glow-text-gradient`}>ProcessManager</h1>
          <p className={styles.userInfo}>Angemeldet als: <strong>{userEmail}</strong></p>
        </div>
        <div className={styles.headerRight}>
          <button onClick={() => fetchProcesses(true)} className="btn btn-secondary" title="Aktualisieren">
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

      {/* System Resources Stats Grid */}
      <section className={styles.statsGrid}>
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

        <div className={`${styles.statCard} glass-panel`}>
          <div className={styles.statHeader}>
            <span>Arbeitsspeicher (PM2)</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2">
              <path d="M6 2v20M18 2v20M6 6h12M6 10h12M6 14h12M6 18h12"></path>
            </svg>
          </div>
          <div className={styles.statValue}>{formatMemory(totalMemoryBytes)}</div>
          <div className={styles.statDetails}>Gesamter RAM aller aktiven PM2-Prozesse</div>
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
    </div>
  );
}
