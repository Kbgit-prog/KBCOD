import { handle } from "hono/vercel";
import { waitUntil } from "@vercel/functions";
import { createApp } from "../src/server/app";

export const config = { maxDuration: 60 };

const app = createApp({ defer: (p) => waitUntil(p) });

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
