"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Bitte füllen Sie alle Felder aus.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Anmeldung fehlgeschlagen");
      }

      // Force route refresh to update middleware state and redirect to dashboard
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ein unerwarteter Fehler ist aufgetreten.");
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.loginCard} glass-panel`}>
        <div className={styles.glowBlob}></div>
        <div className={styles.glowBlob2}></div>

        <div className={styles.header}>
          <h1 className={`${styles.title} glow-text-primary`}>ProcessManager</h1>
          <p className={styles.subtitle}>Melde dich an, um deine Prozesse zu verwalten</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className={styles.errorBox}>
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
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="email">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder="name@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="password">
              Passwort
            </label>
            <input
              id="password"
              type="password"
              className="input-field"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className={`${styles.submitBtn} btn btn-primary`}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <svg
                  className="spinner"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="2" x2="12" y2="6"></line>
                  <line x1="12" y1="18" x2="12" y2="22"></line>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                  <line x1="2" y1="12" x2="6" y2="12"></line>
                  <line x1="18" y1="12" x2="22" y2="12"></line>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <span>Anmelden...</span>
              </>
            ) : (
              <span>Anmelden</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
