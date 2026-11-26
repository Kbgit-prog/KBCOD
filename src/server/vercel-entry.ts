import { getRequestListener } from "@hono/node-server";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app";

// Fonction Vercel (Build Output API, launcherType « Nodejs ») : le lanceur appelle handler(req, res).
// getRequestListener adapte l'application Hono (Request/Response) à cette signature Node.
// Ne pas remplacer par `hono/vercel` : ce gestionnaire Web ne répond jamais avec ce lanceur.
// waitUntil prolonge la fonction pour les travaux lancés après la réponse.
const app = createApp({ defer: (p) => waitUntil(p) });
export default getRequestListener(app.fetch);
