export interface PropertySuggestion { key: string; count?: number }

export const SPECIAL_PROPERTY_KEYS = ["pinned", "status", "tags", "created", "updated"];

export function propertySuggestions(keys: PropertySuggestion[], existing: string[], query: string) {
  const used = new Set(existing.map((key) => key.toLowerCase()));
  const match = (key: string) => key.toLowerCase().includes(query.trim().toLowerCase());
  return {
    pirep: SPECIAL_PROPERTY_KEYS.filter((key) => !used.has(key) && match(key)).map((key) => ({ key })),
    base: keys.filter(({ key }) => !used.has(key.toLowerCase()) && !SPECIAL_PROPERTY_KEYS.includes(key.toLowerCase()) && match(key)),
    create: query.trim() ? query.trim().toLowerCase().replace(/\s+/g, "_") : null,
  };
}
