import { handle } from "hono/vercel";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app";

// Fonction Vercel (Node.js). waitUntil prolonge la fonction pour les travaux lancés après la réponse.
const app = createApp({ defer: (p) => waitUntil(p) });
export default handle(app);
