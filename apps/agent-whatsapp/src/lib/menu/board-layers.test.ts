import { describe, expect, it } from 'vitest';
import {
  BOARD_HEADROOM,
  BOARD_LAYOUTS,
  BOARD_MEATS,
  layoutForMeats,
  meatTop,
  placeSlot,
} from './board-layers';

describe('la tabla por capas', () => {
  // Los huecos se ajustan a ojo: esto avisa si un ajuste deja una carne
  // cortada contra el borde de la tarjeta, con cualquiera de las carnes.
  for (const [name, layout] of Object.entries(BOARD_LAYOUTS)) {
    for (const meat of BOARD_MEATS) {
      it(`${name}: ${meat.name} cabe en el cuadro`, () => {
        for (const slot of layout) {
          expect(slot.x - slot.w / 2).toBeGreaterThanOrEqual(0);
          expect(slot.x + slot.w / 2).toBeLessThanOrEqual(100);
          expect(slot.y).toBeLessThanOrEqual(100);
          expect(meatTop(slot, meat)).toBeGreaterThanOrEqual(-BOARD_HEADROOM);
        }
      });
    }
  }

  it('lo que está más abajo en la foto se pinta encima', () => {
    const [back, front] = BOARD_LAYOUTS.two.map(placeSlot);
    expect(front.z).toBeGreaterThan(back.z);
  });

  it('la base apoya en el fondo del cuadro', () => {
    expect(placeSlot({ x: 50, y: 100, w: 10 }).bottom).toBe(0);
  });

  it('una tabla de 1, 2 o 3 carnes tiene acomodo; de 4 en adelante pide otra base', () => {
    expect(layoutForMeats(1)).toHaveLength(1);
    expect(layoutForMeats(2)).toHaveLength(2);
    expect(layoutForMeats(3)).toHaveLength(3);
    expect(layoutForMeats(4)).toBeNull();
  });
});
