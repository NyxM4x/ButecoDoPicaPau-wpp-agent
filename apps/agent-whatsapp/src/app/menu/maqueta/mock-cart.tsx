'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { formatMoney } from '@/lib/dashboard/format';

/**
 * Un carrito de mentira para la maqueta: junta lo que se agrega desde
 * cualquier opción (una tablita, una bebida, un extra) y muestra cada línea
 * con el nombre que llegaría a la cocina. La carta real tiene el suyo
 * (`lib/cart`); este no guarda nada ni deja pedir.
 */

interface CartLine {
  name: string;
  price: number;
  quantity: number;
}

interface MockCart {
  add: (name: string, price: number) => void;
  quantity: (name: string) => number;
}

const CartContext = createContext<MockCart | null>(null);

export function useMockCart(): MockCart {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useMockCart va dentro de <MockCartProvider>.');
  return cart;
}

export function MockCartProvider({ children, showBar }: { children: ReactNode; showBar: boolean }) {
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [open, setOpen] = useState(false);

  const add = (name: string, price: number) =>
    setLines((current) =>
      current.some((line) => line.name === name)
        ? current.map((line) => (line.name === name ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current, { name, price, quantity: 1 }],
    );
  const removeOne = (name: string) =>
    setLines((current) =>
      current
        .map((line) => (line.name === name ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0),
    );
  const quantity = (name: string) => lines.find((line) => line.name === name)?.quantity ?? 0;

  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);

  return (
    <CartContext value={{ add, quantity }}>
      {children}

      {showBar && units > 0 && !open ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mx-auto flex w-full max-w-md items-center gap-3 rounded-full bg-menu-accent px-5 py-3.5 text-menu-night shadow-xl shadow-black/50 transition-transform active:scale-[0.98]"
          >
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-menu-night px-2 text-sm font-bold text-menu-accent tabular-nums">
              {units}
            </span>
            <span className="flex-1 text-left font-bold">Ver mi pedido</span>
            <span className="font-bold tabular-nums">{formatMoney(total)}</span>
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Tu pedido"
            onClick={(event) => event.stopPropagation()}
            className="mx-auto max-h-[75vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-menu-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ring-1 ring-white/15"
          >
            <h2 className="font-menu-dish text-3xl leading-none font-extrabold text-menu-accent">Tu pedido</h2>
            <p className="mt-1 text-xs text-white/55">Así llegaría cada línea al carrito y a la cocina.</p>
            <ul className="mt-4 divide-y divide-white/10">
              {lines.map((line) => (
                <li key={line.name} className="flex items-center gap-3 py-3">
                  <span className="flex-1 text-sm leading-snug text-white">
                    <span className="font-bold text-menu-accent tabular-nums">{line.quantity} ×</span> {line.name}
                  </span>
                  <span className="text-sm font-semibold text-white/85 tabular-nums">
                    {formatMoney(line.quantity * line.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOne(line.name)}
                    aria-label={`Quitar una ${line.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-lg leading-none text-white ring-1 ring-white/20"
                  >
                    −
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-baseline justify-between border-t border-white/15 pt-3">
              <span className="font-menu-dish text-xl font-semibold text-menu-accent">Total</span>
              <span className="text-2xl font-bold text-white tabular-nums">{formatMoney(total)}</span>
            </p>
            <p className="mt-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-xs leading-relaxed text-white/65">
              Maqueta: en la carta real, desde aquí sigue el pedido (envío o retiro, y pago). Comida preparada al
              momento: espera de 30 a 40 minutos.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-full bg-menu-accent px-5 py-3.5 font-bold text-menu-night"
            >
              Seguir viendo
            </button>
          </div>
        </div>
      ) : null}
    </CartContext>
  );
}
