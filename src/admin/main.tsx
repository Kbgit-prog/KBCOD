import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./admin.css";
import { api, errorText } from "./lib/api";
import { Dashboard } from "./pages/Dashboard";
import { FormsPage } from "./pages/Forms";
import { OffersPage } from "./pages/Offers";
import { OrdersPage } from "./pages/Orders";
import { SheetsPage } from "./pages/Sheets";
import { TrackingPage } from "./pages/Tracking";
import { FraudPage } from "./pages/Fraud";
import { MessagingPage } from "./pages/Messaging";
import { ShippingPage } from "./pages/Shipping";
import { AbandonedPage } from "./pages/Abandoned";
import { SettingsPage } from "./pages/Settings";
import type { Bootstrap } from "./lib/types";

const PAGES = [
  ["dashboard", "Tableau de bord"],
  ["forms", "Formulaires"],
  ["offers", "Offres & Upsells"],
  ["orders", "Commandes"],
  ["sheets", "Google Sheets"],
  ["tracking", "Pixels & Tracking"],
  ["fraud", "Antifraude"],
  ["shipping", "Livraison & réductions"],
  ["messaging", "SMS / WhatsApp"],
  ["abandoned", "Abandons"],
  ["settings", "Paramètres"],
] as const;
export type PageKey = (typeof PAGES)[number][0];

function App() {
  const initial = (new URLSearchParams(location.search).get("page") as PageKey) || "dashboard";
  const [page, setPage] = useState<PageKey>(PAGES.some((p) => p[0] === initial) ? initial : "dashboard");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setBoot(await api<Bootstrap>("/bootstrap"));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const go = (p: PageKey) => {
    setPage(p);
    const u = new URL(location.href);
    u.searchParams.set("page", p);
    history.replaceState(null, "", u);
    window.scrollTo(0, 0);
  };

  if (!window.__KBCOD_API_KEY__) {
    return <div className="app"><div className="banner err">Ouvrez KB COD Manager depuis l'administration Shopify.</div></div>;
  }
  if (error) return <div className="app"><div className="banner err">{error}</div><button className="btn" onClick={load}>Réessayer</button></div>;
  if (!boot) return <div className="app"><div className="empty"><span className="spinner" /> Chargement…</div></div>;

  const ctx = { boot, reloadBoot: load, go };
  return (
    <div className="app">
      <div className="topbar">
        <h1>KB COD Manager</h1>
        <span className="muted small">{boot.shop.name} · {boot.shop.domain}</span>
      </div>
      <nav className="nav">
        {PAGES.map(([k, l]) => (
          <button key={k} className={page === k ? "on" : ""} onClick={() => go(k)}>
            {l}
          </button>
        ))}
      </nav>
      {page === "dashboard" && <Dashboard {...ctx} />}
      {page === "forms" && <FormsPage {...ctx} />}
      {page === "offers" && <OffersPage {...ctx} />}
      {page === "orders" && <OrdersPage {...ctx} />}
      {page === "sheets" && <SheetsPage {...ctx} />}
      {page === "tracking" && <TrackingPage {...ctx} />}
      {page === "fraud" && <FraudPage {...ctx} />}
      {page === "shipping" && <ShippingPage {...ctx} />}
      {page === "messaging" && <MessagingPage {...ctx} />}
      {page === "abandoned" && <AbandonedPage {...ctx} />}
      {page === "settings" && <SettingsPage {...ctx} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
