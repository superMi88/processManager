"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../dashboard.module.css";

interface DatabaseInfo {
  type: "postgres" | "mongodb" | "unknown";
  name: string;
  host: string;
  user: string;
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

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [isDbsLoading, setIsDbsLoading] = useState(true);
  
  const router = useRouter();

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
    const initializePage = async () => {
      await fetchSession();
      await fetchDatabases(true);
    };
    initializePage();

    const dbInterval = setInterval(() => {
      fetchDatabases(false);
    }, 3000);

    return () => clearInterval(dbInterval);
  }, [fetchSession, fetchDatabases]);

  // Helper: Format Memory bytes
  const formatMemory = (bytes: number) => {
    if (bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  // Stats calculations
  const totalDatabases = databases.length;
  const onlineDatabases = databases.filter((db) => db.status === "online").length;
  const offlineDatabases = databases.filter((db) => db.status === "offline").length;
  const totalSizeBytes = databases
    .filter((db) => db.status === "online")
    .reduce((sum, db) => sum + db.sizeBytes, 0);

  const pgCount = databases.filter((db) => db.type === "postgres").length;
  const mongoCount = databases.filter((db) => db.type === "mongodb").length;

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={`${styles.title} glow-text-gradient`}>ProcessManager</h1>
          <p className={styles.userInfo}>Angemeldet als: <strong>{userEmail}</strong></p>
        </div>
        <div className={styles.headerRight}>
          <button onClick={() => fetchDatabases(true)} className="btn btn-secondary" title="Aktualisieren">
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

      {/* Database Resources Stats Grid */}
      <section className={styles.statsGrid}>
        <div className={`${styles.statCard} glass-panel`}>
          <div className={styles.statHeader}>
            <span>Erkannte Datenbanken</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
          </div>
          <div className={styles.statValue}>{totalDatabases}</div>
          <div className={styles.statDetails}>
            {onlineDatabases} Online &bull; {offlineDatabases} Offline
          </div>
        </div>

        <div className={`${styles.statCard} glass-panel`}>
          <div className={styles.statHeader}>
            <span>Datenbank-Typen</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
              <line x1="15" y1="3" x2="15" y2="21"></line>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="3" y1="15" x2="21" y2="15"></line>
            </svg>
          </div>
          <div className={styles.statValue}>
            {pgCount} PG / {mongoCount} MG
          </div>
          <div className={styles.statDetails}>PostgreSQL und MongoDB Instanzen</div>
        </div>

        <div className={`${styles.statCard} glass-panel`}>
          <div className={styles.statHeader}>
            <span>Gesamte Datengröße</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2">
              <path d="M6 2v20M18 2v20M6 6h12M6 10h12M6 14h12M6 18h12"></path>
            </svg>
          </div>
          <div className={styles.statValue}>{formatMemory(totalSizeBytes)}</div>
          <div className={styles.statDetails}>Gesamter Speicherplatz aller erreichbaren DBs</div>
        </div>
      </section>

      {/* Navigation Switcher */}
      <div className={styles.tabsContainer}>
        <Link href="/" className={styles.tabButton}>
          PM2 Prozesse
        </Link>
        <span className={`${styles.tabButton} ${styles.tabButtonActive}`}>
          Datenbanken (Auto-Discovery)
        </span>
      </div>

      {/* Databases Auto-Discovery view */}
      <section>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Erkannte Datenbanken</h2>
        </div>

        {isDbsLoading ? (
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
            <p style={{ marginTop: "1rem", color: "var(--text-secondary)" }}>Datenbanken werden gescannt...</p>
          </div>
        ) : databases.length === 0 ? (
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
              <p>Keine Datenbanken automatisch erkannt.</p>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", maxWidth: "450px", margin: "0 auto" }}>
                Der Scanner sucht in den Umgebungsvariablen aktiver PM2-Prozesse nach Verbindungsparametern (wie <code>DATABASE_URL</code> oder <code>MONGODB_URI</code>).
              </p>
            </div>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.processTable}>
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>Name / Host</th>
                  <th>PM2-Quelle</th>
                  <th>Benutzer</th>
                  <th>Status</th>
                  <th>Größe</th>
                  <th>Statistiken / Details</th>
                </tr>
              </thead>
              <tbody>
                {databases.map((db, idx) => (
                  <tr key={idx}>
                    <td>
                      <div
                        className={`${styles.dbTypeIcon} ${
                          db.type === "postgres" ? styles.dbTypePostgres : styles.dbTypeMongodb
                        }`}
                        title={db.type}
                      >
                        {db.type === "postgres" ? "PG" : "MG"}
                      </div>
                    </td>
                    <td>
                      <div className={styles.processName}>
                        <span>{db.name}</span>
                        <span className={styles.pmId}>{db.host}</span>
                      </div>
                      <div className={styles.dbMaskedUri} title={db.maskedUri}>
                        {db.maskedUri}
                      </div>
                    </td>
                    <td>
                      <span className={styles.pmId}>{db.sourceProcess}</span>
                    </td>
                    <td className={styles.monoText}>{db.user}</td>
                    <td>
                      {db.status === "online" ? (
                        <span className="badge badge-online">
                          <span className="pulse-dot pulse-dot-online"></span>Online
                        </span>
                      ) : (
                        <span className="badge badge-stopped" title={db.error}>
                          <span className="pulse-dot pulse-dot-stopped"></span>Offline
                        </span>
                      )}
                    </td>
                    <td className={styles.monoText}>
                      {db.status === "online" ? formatMemory(db.sizeBytes) : "—"}
                    </td>
                    <td>
                      {db.status === "online" ? (
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                          {db.type === "postgres" && (
                            <>
                              <div>Tabellen: <strong>{db.tablesCount ?? 0}</strong></div>
                              <div>Verbindungen: <strong>{db.connectionCount ?? 0}</strong></div>
                            </>
                          )}
                          {db.type === "mongodb" && (
                            <>
                              <div>Collections: <strong>{db.collectionsCount ?? 0}</strong></div>
                              <div>Dokumente: <strong>{db.documentsCount?.toLocaleString() ?? 0}</strong></div>
                            </>
                          )}
                        </div>
                      ) : (
                        <span 
                          style={{ 
                            fontSize: "0.75rem", 
                            color: "var(--danger)", 
                            maxWidth: "200px", 
                            display: "inline-block", 
                            wordBreak: "break-word" 
                          }} 
                          title={db.error}
                        >
                          {db.error || "Verbindungsfehler"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
