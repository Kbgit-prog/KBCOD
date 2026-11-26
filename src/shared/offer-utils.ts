/** Utilitaires sans dépendance (utilisables dans le script de vitrine). */
export function appliesToProduct(ids: string[], productId: string): boolean {
  return ids.length === 0 || ids.includes(productId);
}
