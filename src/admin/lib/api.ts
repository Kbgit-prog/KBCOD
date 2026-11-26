declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
      toast: { show: (msg: string, opts?: { isError?: boolean; duration?: number }) => void };
      resourcePicker?: (o: Record<string, unknown>) => Promise<any[] | undefined>;
      config?: { shop?: string };
    };
    __KBCOD_API_KEY__?: string;
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: string[] = []) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = window.shopify ? await window.shopify.idToken() : "";
  const res = await fetch(`/api/admin${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Erreur ${res.status}`, res.status, json.errors ?? []);
  return json as T;
}

export function toast(msg: string, isError = false) {
  if (window.shopify?.toast) window.shopify.toast.show(msg, { isError, duration: isError ? 6000 : 3000 });
  else if (isError) console.error(msg);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.errors.length ? `${e.message} : ${e.errors.slice(0, 5).join(" ; ")}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

export async function pickProducts(multiple = true): Promise<{ id: string; title: string; image: string | null; variants: { id: string; title: string; price: number }[] }[] | null> {
  if (!window.shopify?.resourcePicker) return null;
  const sel = await window.shopify.resourcePicker({ type: "product", multiple, action: "select" });
  if (!sel) return [];
  return sel.map((p: any) => ({
    id: String(p.id).split("/").pop()!,
    title: p.title,
    image: p.images?.[0]?.originalSrc ?? p.images?.[0]?.url ?? null,
    variants: (p.variants ?? []).map((v: any) => ({ id: String(v.id).split("/").pop()!, title: v.title, price: Math.round(Number.parseFloat(v.price ?? "0") * 100) })),
  }));
}
