import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@/types';
import {
  CATEGORY_TABS,
  categoryLabel,
  filterMenuItems,
  groupByCategory,
  normalizeText,
  productDescription,
  productImage,
} from './catalog';

function item(
  code: string,
  name: string,
  category: MenuItem['category'],
  price: number,
  sort_order: number,
): MenuItem {
  return {
    id: `id-${code}`,
    code,
    name,
    category,
    price,
    is_active: true,
    sort_order,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** Mismo catálogo que `supabase/seed.sql`. */
const MENU: MenuItem[] = [
  item('picanha', 'Picanha', 'plato', 30, 10),
  item('supertabla', 'Supertabla', 'plato', 18, 20),
  item('chuleta', 'Chuleta', 'plato', 18, 30),
  item('alita', 'Alita', 'plato', 15, 40),
  item('keperi', 'Keperi', 'plato', 18, 50),
  item('sopa', 'Sopa', 'plato', 18, 60),
  item('gaseosa_2l', 'Gaseosa 2 L', 'bebida', 18, 70),
  item('gaseosa_personal', 'Gaseosa personal', 'bebida', 8, 80),
  item('porcion_papas', 'Porción de papa', 'extra', 7, 100),
];

describe('categorías', () => {
  it('expone las 4 pestañas en orden', () => {
    // 17-09-2026: los extras subieron delante de las bebidas, para ir en el
    // MISMO orden que las secciones (`CATEGORY_SECTION_ORDER`). Si discrepan,
    // tocar "Extras" lleva a un sitio distinto del que se ve al desplazarse.
    expect(CATEGORY_TABS.map((t) => t.id)).toEqual(['all', 'plato', 'extra', 'bebida']);
    expect(CATEGORY_TABS.map((t) => t.label)).toEqual([
      'Todo',
      'Platos',
      'Extras',
      'Bebidas',
    ]);
  });

  it('traduce las categorías del esquema a etiquetas visibles', () => {
    expect(categoryLabel('plato')).toBe('Platos');
    expect(categoryLabel('bebida')).toBe('Bebidas');
    expect(categoryLabel('extra')).toBe('Extras');
  });

  it('no expone categorías ficticias (Combos, Papas, Promos…)', () => {
    // Solo existen 3 categorías reales en el esquema + la pestaña "all".
    const realIds = CATEGORY_TABS.map((t) => t.id);
    expect(realIds).toEqual(['all', 'plato', 'extra', 'bebida']);
    expect(realIds).toHaveLength(4);

    const labels = CATEGORY_TABS.map((t) => t.label.toLowerCase());
    for (const fake of ['combos', 'combo', 'papas', 'promos', 'promociones', 'menús']) {
      expect(labels, fake).not.toContain(fake);
    }
  });
});

describe('filterMenuItems — filtrado por categoría', () => {
  it('"all" devuelve todo el catálogo sin reordenar', () => {
    expect(filterMenuItems(MENU, 'all', '')).toEqual(MENU);
  });

  it('filtra platos', () => {
    const result = filterMenuItems(MENU, 'plato', '');
    expect(result.map((i) => i.code)).toEqual([
      'picanha',
      'supertabla',
      'chuleta',
      'alita',
      'keperi',
      'sopa',
    ]);
  });

  it('filtra bebidas y extras', () => {
    expect(filterMenuItems(MENU, 'bebida', '').map((i) => i.code)).toEqual([
      'gaseosa_2l',
      'gaseosa_personal',
    ]);
    expect(filterMenuItems(MENU, 'extra', '').map((i) => i.code)).toEqual(['porcion_papas']);
  });
});

describe('filterMenuItems — búsqueda', () => {
  it('encuentra por nombre, sin distinguir mayúsculas', () => {
    expect(filterMenuItems(MENU, 'all', 'chulet').map((i) => i.code)).toEqual([
      'chuleta',
    ]);
    expect(filterMenuItems(MENU, 'all', 'KEPERI').map((i) => i.code)).toEqual(['keperi']);
  });

  it('ignora acentos en ambos sentidos', () => {
    expect(filterMenuItems(MENU, 'all', 'porción').map((i) => i.code)).toEqual([
      'porcion_papas',
    ]);
    expect(filterMenuItems(MENU, 'extra', 'porcion de papa').map((i) => i.code)).toEqual([
      'porcion_papas',
    ]);
  });

  it('encuentra por descripción (la que trae el producto del POS)', () => {
    const conDescripcion = [
      { ...item('supertabla', 'Supertabla', 'plato', 950, 0), description: 'Arroz, plátano y cinco carnes a elección.' },
      { ...item('keperi', 'Keperi', 'plato', 70, 1), description: null },
    ];
    expect(filterMenuItems(conDescripcion, 'all', 'cinco carnes').map((i) => i.code)).toEqual(['supertabla']);
  });

  it('combina búsqueda con la categoría activa', () => {
    expect(filterMenuItems(MENU, 'bebida', 'gaseosa')).toHaveLength(2);
    expect(filterMenuItems(MENU, 'extra', 'gaseosa')).toEqual([]);
  });

  it('ignora espacios sobrantes y devuelve vacío si no hay coincidencias', () => {
    expect(filterMenuItems(MENU, 'all', '   ')).toEqual(MENU);
    expect(filterMenuItems(MENU, 'all', 'sushi')).toEqual([]);
  });

  it('normalizeText baja a minúsculas y quita acentos', () => {
    expect(normalizeText('  Porción DE Papa ')).toBe('porcion de papa');
  });
});

describe('descripciones e imágenes', () => {
  it('sin POS no hay descripciones escritas en el código', () => {
    // Las de la demo anterior se retiraron: con el POS, cada producto trae la suya.
    for (const menuItem of MENU) {
      expect(productDescription(menuItem.code), menuItem.code).toBeNull();
    }
  });

  it('un código desconocido no tiene descripción', () => {
    expect(productDescription('producto_inexistente')).toBeNull();
  });

  it('sin POS ningún producto tiene foto escrita en el código: sale el placeholder', () => {
    for (const menuItem of MENU) {
      expect(productImage(menuItem).src, menuItem.code).toBeNull();
    }
  });

  it('todo producto del seed declara emoji de fallback y nombre de archivo', () => {
    for (const menuItem of MENU) {
      const image = productImage(menuItem);
      expect(image.emoji, menuItem.code).not.toBe('');
      expect(image.file, menuItem.code).toMatch(/^[a-z0-9-]+\.webp$/);
    }
  });

  it('un producto nuevo (código no mapeado) cae al placeholder de su categoría', () => {
    const image = productImage({ code: 'combo_nuevo', category: 'bebida' });
    expect(image.src).toBeNull();
    expect(image.file).toBe('combo-nuevo.webp');
    expect(image.emoji).toBe('🥤');
  });
});

describe('groupByCategory', () => {
  it('agrupa en el orden de secciones: platos, extras, bebidas', () => {
    // 17-09-2026: el orden ya NO es el de llegada (que era el del `sort_order`
    // y dejaba los extras al final, detrás de los jugos). Los extras van entre
    // los platos y las bebidas porque la porción de papa acompaña a la comida.
    const groups = groupByCategory(MENU);
    expect(groups.map((g) => g.category)).toEqual(['plato', 'extra', 'bebida']);
    expect(groups.map((g) => g.label)).toEqual(['Platos', 'Extras', 'Bebidas']);
    expect(groups.find((g) => g.category === 'plato')?.items).toHaveLength(6);
    expect(groups.find((g) => g.category === 'bebida')?.items).toHaveLength(2);
    expect(groups.find((g) => g.category === 'extra')?.items).toHaveLength(1);
  });

  it('con lista vacía devuelve ningún grupo', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  /**
   * LO AGOTADO BAJA, PERO NO DESAPARECE (07-09-2026).
   *
   * Desde que la vitrina enseña los agotados en gris, el `sort_order` del panel
   * puede dejar en la primera tarjeta de la pantalla lo único que no se puede
   * pedir. Bajan al final de su grupo, y ahí se quedan: no se filtran.
   */
  it('los agotados van al final de su categoría, sin perderse', () => {
    const agotado = (code: string, orden: number): MenuItem => ({
      ...item(code, code, 'plato', 20, orden),
      is_active: false,
    });

    const groups = groupByCategory([
      agotado('supertabla', 0),
      item('alita', 'Alita', 'plato', 25, 1),
      agotado('keperi', 2),
      item('sopa', 'Sopa', 'plato', 18, 3),
    ]);

    expect(groups[0].items.map((i) => i.code)).toEqual([
      'alita',
      'sopa',
      'supertabla',
      'keperi',
    ]);
  });

  it('sin orden de vitrina en el código, los platos siguen el orden recibido', () => {
    const groups = groupByCategory([
      item('nuevo_plato', 'Plato nuevo', 'plato', 20, 5),
      item('keperi', 'Keperi', 'plato', 18, 50),
      item('supertabla', 'Supertabla', 'plato', 18, 20),
    ]);
    expect(groups[0].items.map((i) => i.code)).toEqual(['nuevo_plato', 'keperi', 'supertabla']);
  });

  it('no muta la lista que recibe', () => {
    const entrada = [
      { ...item('a', 'A', 'plato', 10, 0), is_active: false },
      item('b', 'B', 'plato', 10, 1),
    ];
    const antes = entrada.map((i) => i.code);
    groupByCategory(entrada);
    expect(entrada.map((i) => i.code)).toEqual(antes);
  });
});
