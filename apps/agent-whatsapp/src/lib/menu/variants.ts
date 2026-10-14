/**
 * Un plato con opciones a elección — módulo PURO.
 *
 * Una «Tabla» que se sirve con seis carnes distintas son, en el POS, seis
 * productos: cada uno con su precio, su foto y su «agotado». Listarlos uno
 * debajo del otro llena la pantalla con seis tarjetas casi iguales, así que el
 * menú los junta en UNA, con las carnes como opciones.
 *
 * ── Cómo sabe el menú que van juntos ────────────────────────────────────────
 *
 * Por el nombre, sin tocar el contrato del POS: dos o más productos de la
 * misma categoría cuyo nombre empieza igual y sigue con un separador.
 *
 *   Tabla - Pollo frito      →  plato «Tabla», opción «Pollo frito»
 *   Tabla - Costilla         →  plato «Tabla», opción «Costilla»
 *
 * Sirven ` - `, ` – `, ` — `, ` · ` y ` | `, siempre con un espacio a cada lado:
 * «Coca-Cola» no se parte. Y hacen falta al menos dos: un «Pique - Especial»
 * solo, sin hermanos, se queda como un producto cualquiera con su nombre entero.
 *
 * El nombre completo es el que ven el carrito, la cocina y los mensajes de
 * WhatsApp, así que conviene que se entienda solo: «Tabla - Pollo frito».
 */
import type { MenuItem } from '@/types';
import { normalizeText } from './catalog';

const SEPARATOR = /\s+[-–—·|]\s+/;

export interface VariantOption {
  /** Lo que cambia entre una opción y otra: «Pollo frito». */
  label: string;
  item: MenuItem;
}

export type CatalogEntry =
  | { kind: 'single'; key: string; item: MenuItem }
  | {
      kind: 'family';
      key: string;
      /** Lo que tienen en común: «Tabla». */
      name: string;
      options: VariantOption[];
    };

/** Parte «Tabla - Pollo frito» en plato y opción, o `null` si no tiene esa forma. */
export function splitVariantName(name: string): { family: string; label: string } | null {
  const match = SEPARATOR.exec(name);
  if (!match) return null;
  const family = name.slice(0, match.index).trim();
  const label = name.slice(match.index + match[0].length).trim();
  return family !== '' && label !== '' ? { family, label } : null;
}

/**
 * Los productos de UNA sección, con las opciones de un mismo plato juntas.
 *
 * El orden es el recibido: cada plato con opciones ocupa el lugar de su primera
 * opción, y dentro de él las opciones siguen el orden en que venían (las
 * agotadas ya llegan al final, ver `groupByCategory`).
 */
export function groupVariants(items: MenuItem[]): CatalogEntry[] {
  const families = new Map<string, { name: string; options: VariantOption[] }>();
  for (const item of items) {
    const parts = splitVariantName(item.name);
    if (!parts) continue;
    const key = normalizeText(parts.family);
    const family = families.get(key);
    if (family) family.options.push({ label: parts.label, item });
    else families.set(key, { name: parts.family, options: [{ label: parts.label, item }] });
  }

  const placed = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const item of items) {
    const parts = splitVariantName(item.name);
    const key = parts ? normalizeText(parts.family) : null;
    const family = key === null ? undefined : families.get(key);

    if (!family || family.options.length < 2) {
      entries.push({ kind: 'single', key: item.code, item });
      continue;
    }
    if (placed.has(key as string)) continue;
    placed.add(key as string);
    entries.push({ kind: 'family', key: `family:${key}`, name: family.name, options: family.options });
  }
  return entries;
}

/** La opción con la que abre la tarjeta: la primera que se puede pedir. */
export function defaultOption(options: VariantOption[]): VariantOption {
  return options.find((option) => option.item.is_active) ?? options[0];
}

/** El precio más bajo entre las opciones que se pueden pedir (o entre todas, si no hay ninguna). */
export function lowestPrice(options: VariantOption[]): number {
  const available = options.filter((option) => option.item.is_active);
  const pool = available.length > 0 ? available : options;
  return Math.min(...pool.map((option) => Number(option.item.price)));
}

/** ¿Todas las opciones cuestan lo mismo? Si no, la tarjeta dice «desde». */
export function samePrice(options: VariantOption[]): boolean {
  return new Set(options.map((option) => Number(option.item.price))).size <= 1;
}
