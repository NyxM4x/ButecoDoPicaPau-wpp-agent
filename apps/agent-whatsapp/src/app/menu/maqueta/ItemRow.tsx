'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/dashboard/format';
import { AddButton, Chip } from './BoardCards';
import type { MockupItem } from './data';
import { useMockCart } from './mock-cart';

/**
 * Una bebida o un extra: fila compacta, sin foto (como los productos sin foto
 * de la carta). Con más de un tamaño, se elige ahí mismo y el precio cambia.
 */
export function ItemRow({ item }: { item: MockupItem }) {
  const cart = useMockCart();
  const [sizeIndex, setSizeIndex] = useState(0);
  const size = item.sizes[sizeIndex] ?? item.sizes[0];
  const line = size.label ? `${item.name} ${size.label}` : item.name;

  return (
    <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3.5 backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <p className="font-menu-dish text-[1.75rem] leading-none font-extrabold text-menu-accent">{item.name}</p>
        {item.note ? <p className="mt-1 text-xs font-semibold text-white/60">{item.note}</p> : null}
        {item.sizes.length > 1 ? (
          <div role="radiogroup" aria-label={`Tamaño de ${item.name}`} className="mt-2 flex flex-wrap gap-1.5">
            {item.sizes.map((option, index) => (
              <Chip key={option.label} radio selected={index === sizeIndex} onClick={() => setSizeIndex(index)}>
                {option.label}
              </Chip>
            ))}
          </div>
        ) : size.label ? (
          <p className="mt-1 text-xs text-white/60">{size.label}</p>
        ) : null}
      </div>
      <span className="text-xl font-bold whitespace-nowrap text-white tabular-nums">{formatMoney(size.price)}</span>
      <AddButton onClick={() => cart.add(line, size.price)} label={`Agregar ${line}`} inCart={cart.quantity(line)} />
    </div>
  );
}
