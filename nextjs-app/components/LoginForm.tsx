"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { t } from "@/lang";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || !data.ok) {
        setError(data.message ?? t.login.invalid);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t.login.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <svg width="56" height="56" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="8" fill="#6366F1" />
            <path d="M8 12h16M8 16h12M8 20h8" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h1>{t.login.title}</h1>
          <p>{t.login.subtitle}</p>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <form className="login-form" autoComplete="off" onSubmit={(event) => void onSubmit(event)}>
          <div className="form-group">
            <label htmlFor="benutzername">{t.login.username}</label>
            <input
              id="benutzername"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t.login.usernamePlaceholder}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="passwort">{t.login.password}</label>
            <div className="password-input-wrap">
              <input
                id="passwort"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t.login.passwordPlaceholder}
                required
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((prev) => !prev)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>

          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? t.login.submitting : t.login.submit}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {t.login.standard}: <strong>admin</strong> / <strong>admin123</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
