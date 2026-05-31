// Project owner: Levent Cetin
"use client";

import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/LanguageProvider";
import { NavBar } from "@/components/NavBar";
import { t } from "@/lang";

type AppShellProps = {
  username: string;
  title?: string;
  subtitle?: string;
  pageClassName?: string;
  children: ReactNode;
};

export function AppShell({ username, title, subtitle, pageClassName, children }: AppShellProps) {
  return (
    <LanguageProvider>
      <NavBar username={username} />
      <main className="main-content">
        <div className={pageClassName ?? ""}>
          {title ? (
            <div className="section-header">
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
      <footer className="footer">
        <p>
          &copy; {new Date().getFullYear()} {t.app.name} - {t.app.footer}
        </p>
      </footer>
    </LanguageProvider>
  );
}
