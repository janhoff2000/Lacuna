import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import { openDatabase } from "../server/db";
import { readSettings } from "../server/operations";
import { Shell, ThemeSync, WorkspaceError } from "./components/workspace";
import { themeScript } from "./lib/workspace";

import "./styles/workspace.css";

export function loader() {
  const db = openDatabase();
  try {
    const appearance = String(readSettings(db).appearance);
    return {
      appearance: ["light", "dark"].includes(appearance)
        ? appearance
        : "system",
    };
  } finally {
    db.close();
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const settings = useRouteLoaderData<typeof loader>("root");
  const appearance = settings?.appearance ?? "dark";
  return (
    <html
      lang="en"
      data-theme={appearance === "system" ? undefined : appearance}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script dangerouslySetInnerHTML={{ __html: themeScript(appearance) }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { appearance } = useLoaderData<typeof loader>();
  return (
    <>
      <ThemeSync appearance={appearance} />
      <Shell>
        <Outlet />
      </Shell>
    </>
  );
}

export function ErrorBoundary() {
  return (
    <Shell>
      <WorkspaceError />
    </Shell>
  );
}
