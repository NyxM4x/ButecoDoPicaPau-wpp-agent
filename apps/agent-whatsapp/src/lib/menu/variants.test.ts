import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@/types';
import { defaultOption, groupVariants, lowestPrice, samePrice, splitVariantName } from './variants';

function item(over: Partial<MenuItem> & Pick<MenuItem, 'code' | 'name'>): MenuItem {
  return {
    id: over.code,
    category: 'plato',
    price: 60,
    is_active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('splitVariantName', () => {
  it('parte el nombre en plato y opción', () => {
    expect(splitVariantName('Tabla - Pollo frito')).toEqual({ family: 'Tabla', label: 'Pollo frito' });
    expect(splitVariantName('Tabla · Costilla')).toEqual({ family: 'Tabla', label: 'Costilla' });
    expect(splitVariantName('Cerveza — 1 litro')).toEqual({ family: 'Cerveza', label: '1 litro' });
  });

  it('solo parte en el PRIMER separador', () => {
    expect(splitVariantName('Tabla - Pollo - Picante')).toEqual({ family: 'Tabla', label: 'Pollo - Picante' });
  });

  it('un guion sin espacios es parte del nombre', () => {
    expect(splitVariantName('Coca-Cola')).toBeNull();
    expect(splitVariantName('Pique macho')).toBeNull();
    expect(splitVariantName('Tabla -')).toBeNull();
  });
});

describe('groupVariants', () => {
  const tablas = [
    item({ code: 'tabla_pollo', name: 'Tabla - Pollo frito' }),
    item({ code: 'tabla_costilla', name: 'Tabla - Costilla', price: 70 }),
    item({ code: 'tabla_res', name: 'tabla - Res' }),
  ];

  it('junta en un solo plato las opciones que comparten el comienzo del nombre', () => {
    const entries = groupVariants(tablas);
    expect(entries).toHaveLength(1);
    const [family] = entries;
    expect(family.kind).toBe('family');
    if (family.kind !== 'family') return;
    expect(family.name).toBe('Tabla');
    // Mayúsculas y acentos no separan: «tabla - Res» es de la misma familia.
    expect(family.options.map((o) => o.label)).toEqual(['Pollo frito', 'Costilla', 'Res']);
    expect(family.options.map((o) => o.item.code)).toEqual(['tabla_pollo', 'tabla_costilla', 'tabla_res']);
  });

  it('el plato ocupa el lugar de su primera opción, y lo demás sigue en orden', () => {
    const entries = groupVariants([
      item({ code: 'pique', name: 'Pique macho' }),
      tablas[0],
      item({ code: 'silpancho', name: 'Silpancho' }),
      tablas[1],
    ]);
    expect(entries.map((entry) => entry.key)).toEqual(['pique', 'family:tabla', 'silpancho']);
  });

  it('una sola opción no es un plato con opciones: conserva su nombre entero', () => {
    const entries = groupVariants([item({ code: 'pique_especial', name: 'Pique - Especial' })]);
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'single', item: expect.objectContaining({ name: 'Pique - Especial' }) }),
    ]);
  });

  it('sin separadores, todo queda como estaba', () => {
    const plain = [item({ code: 'a', name: 'Pique macho' }), item({ code: 'b', name: 'Charque' })];
    expect(groupVariants(plain).map((entry) => entry.kind)).toEqual(['single', 'single']);
  });
});

describe('opciones de un plato', () => {
  const options = [
    { label: 'Pollo', item: item({ code: 'a', name: 'Tabla - Pollo', price: 80, is_active: false }) },
    { label: 'Costilla', item: item({ code: 'b', name: 'Tabla - Costilla', price: 70 }) },
    { label: 'Res', item: item({ code: 'c', name: 'Tabla - Res', price: 60, is_active: false }) },
  ];

  it('abre en la primera opción que se puede pedir', () => {
    expect(defaultOption(options).label).toBe('Costilla');
    // Con todo agotado, la primera: algo hay que enseñar.
    expect(defaultOption([options[0], options[2]]).label).toBe('Pollo');
  });

  it('el «desde» es el precio más bajo que se puede pedir', () => {
    expect(lowestPrice(options)).toBe(70);
    expect(lowestPrice([options[0], options[2]])).toBe(60);
  });

  it('sabe si todas cuestan lo mismo', () => {
    expect(samePrice(options)).toBe(false);
    expect(samePrice([options[1], { ...options[1], label: 'Otra' }])).toBe(true);
  });
});
