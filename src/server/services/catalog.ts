import type { CatalogVariant } from "../../shared/pricing";
import { toMinor } from "../../shared/pricing";
import type { AdminClient } from "../shopify/graphql";
import { gid, idFromGid } from "../shopify/graphql";

export const VARIANTS_QUERY = `#graphql
  query KbVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        sku
        price
        compareAtPrice
        availableForSale
        image { url }
        product { id title featuredImage { url } }
      }
    }
  }`;

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  image: { url: string } | null;
  product: { id: string; title: string; featuredImage: { url: string } | null };
}

/** Lit les variantes faisant foi (prix, disponibilité) depuis l'Admin API. */
export async function loadVariants(client: AdminClient, variantIds: string[]): Promise<Map<string, CatalogVariant>> {
  const unique = [...new Set(variantIds)].filter((v) => /^\d+$/.test(v));
  const map = new Map<string, CatalogVariant>();
  if (!unique.length) return map;
  const data = await client.request<{ nodes: (VariantNode | null)[] }>(VARIANTS_QUERY, {
    ids: unique.map((v) => gid("ProductVariant", v)),
  });
  for (const n of data.nodes) {
    if (!n || !n.id) continue;
    const variantId = idFromGid(n.id);
    map.set(variantId, {
      variantId,
      productId: idFromGid(n.product.id),
      productTitle: n.product.title,
      title: n.title,
      price: toMinor(n.price),
      compareAtPrice: n.compareAtPrice ? toMinor(n.compareAtPrice) : null,
      available: n.availableForSale,
      image: n.image?.url ?? n.product.featuredImage?.url ?? null,
      sku: n.sku,
    });
  }
  return map;
}

export const PRODUCT_SEARCH_QUERY = `#graphql
  query KbProducts($query: String, $first: Int!) {
    products(first: $first, query: $query, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        status
        featuredImage { url }
        variants(first: 50) { nodes { id title price availableForSale } }
      }
    }
  }`;

export async function searchProducts(client: AdminClient, q: string) {
  const data = await client.request<{
    products: {
      nodes: {
        id: string;
        title: string;
        handle: string;
        status: string;
        featuredImage: { url: string } | null;
        variants: { nodes: { id: string; title: string; price: string; availableForSale: boolean }[] };
      }[];
    };
  }>(PRODUCT_SEARCH_QUERY, { query: q ? `title:*${q.replace(/["\\]/g, "")}*` : null, first: 25 });
  return data.products.nodes.map((p) => ({
    id: idFromGid(p.id),
    title: p.title,
    handle: p.handle,
    status: p.status,
    image: p.featuredImage?.url ?? null,
    variants: p.variants.nodes.map((v) => ({ id: idFromGid(v.id), title: v.title, price: toMinor(v.price), available: v.availableForSale })),
  }));
}
