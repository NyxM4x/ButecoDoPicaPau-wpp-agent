/** Código de producto a partir del nombre: minúsculas, sin acentos, con guion bajo. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);
}
