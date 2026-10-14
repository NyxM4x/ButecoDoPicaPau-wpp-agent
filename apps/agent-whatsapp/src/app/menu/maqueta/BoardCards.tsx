'use client';

import { useState, type ReactNode } from 'react';
import { BoardStage } from '@/components/menu/BoardStage';
import { formatMoney } from '@/lib/dashboard/format';
import { BOARD_LAYOUTS, BOARD_MEATS, layoutForMeats, type BoardMeat } from '@/lib/menu/board-layers';
import { TABLITA_PRICES, type ShareBoard } from './data';
import { useMockCart } from './mock-cart';

/**
 * Las tarjetas de la maqueta (`/menu/maqueta`): la Tablita y las tablas para
 * compartir, con la tabla por capas, y las piezas que comparten con las
 * bebidas. Los textos y precios están en `data.ts`.
 */

const meatById = (id: string | null): BoardMeat | null => BOARD_MEATS.find((meat) => meat.id === id) ?? null;

/** La Tablita: una carne, y para 1 o para 2 (más porción sobre la misma tabla). */
export function TablitaCard() {
  const [meatId, setMeatId] = useState('costilla-res');
  const [people, setPeople] = useState<1 | 2>(1);
  const cart = useMockCart();

  const meat = meatById(meatId) ?? BOARD_MEATS[0];
  const prices = TABLITA_PRICES[meat.id] ?? null;
  const price = prices ? prices[people - 1] : null;
  const line = `Tablita para ${people} - ${meat.name}`;

  return (
    <article>
      <div className="-mx-3 mb-3 sm:mx-0">
        <BoardStage
          layout={people === 1 ? BOARD_LAYOUTS.single : BOARD_LAYOUTS.singleLarge}
          meats={[meat]}
          label={`Tablita para ${people} con ${meat.name.toLowerCase()}, arroz y plátano`}
        />
      </div>
      <div className="px-1">
        <DishTitle>Tablita</DishTitle>

        <OptionGroup legend="Elige tu carne">
          {BOARD_MEATS.map((option) => (
            <Chip key={option.id} radio selected={option.id === meat.id} onClick={() => setMeatId(option.id)}>
              {option.name}
            </Chip>
          ))}
        </OptionGroup>

        <OptionGroup legend="¿Para cuántos?">
          {([1, 2] as const).map((count) => (
            <Chip key={count} radio selected={count === people} onClick={() => setPeople(count)}>
              {count === 1 ? '1 persona' : '2 personas'}
              {prices ? <span className="tabular-nums opacity-70">{formatMoney(prices[count - 1])}</span> : null}
            </Chip>
          ))}
        </OptionGroup>

        <Description>Arroz, plátano, salsa de ajo y ají.</Description>
        <PriceRow
          price={price}
          missing={price === null ? 'Sin precio en el volante' : null}
          onAdd={() => price !== null && cart.add(line, price)}
          addLabel={`Agregar ${line}`}
          inCart={cart.quantity(line)}
        />
      </div>
    </article>
  );
}

/**
 * Una tabla para compartir: N carnes a elección, cada una en su hueco.
 *
 * Se elige hueco por hueco: el que está marcado recibe la carne que se toque,
 * y la marca pasa al siguiente vacío. Tocar un hueco ya elegido deja cambiar
 * esa carne. Las carnes se pueden repetir (falta que el local lo confirme).
 */
export function ShareBoardCard({ board }: { board: ShareBoard }) {
  // Las tablas de la maqueta son de 2 y 3 carnes: siempre tienen acomodo.
  const layout = layoutForMeats(board.meats) ?? BOARD_LAYOUTS.three;
  const [chosen, setChosen] = useState<readonly (string | null)[]>(() => Array(board.meats).fill(null));
  const [active, setActive] = useState(0);
  const cart = useMockCart();

  const meats = chosen.map(meatById);
  const picked = meats.filter((meat): meat is BoardMeat => meat !== null);
  const missing = board.meats - picked.length;

  function pick(meat: BoardMeat) {
    const next = chosen.map((id, index) => (index === active ? meat.id : id));
    setChosen(next);
    // El siguiente vacío, mirando primero los que vienen después de este.
    const order = next.map((_, offset) => (active + 1 + offset) % next.length);
    const empty = order.find((index) => next[index] === null);
    if (empty !== undefined) setActive(empty);
  }

  function clear() {
    setChosen(Array(board.meats).fill(null));
    setActive(0);
  }

  const line = `${board.name} - ${picked.map((meat) => meat.name).join(' + ')}`;
  const names = picked.map((meat) => meat.name.toLowerCase());
  const label =
    picked.length === 0
      ? `${board.name}, con arroz y plátano, sin carnes elegidas`
      : `${board.name} con ${names.join(', ')}${missing > 0 ? ` y ${missing} por elegir` : ''}`;

  return (
    <article>
      <div className="-mx-3 mb-3 sm:mx-0">
        <BoardStage layout={layout} meats={meats} activeSlot={missing > 0 ? active : null} label={label} />
      </div>
      <div className="px-1">
        <DishTitle>{board.name}</DishTitle>
        <p className="mt-1 text-sm font-semibold text-white/60">{board.people}</p>

        <div role="group" aria-label={`Elige ${board.meats} carnes`} className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-white/55 uppercase">
              Elige {board.meats} carnes
            </p>
            <span
              className={`text-sm font-semibold tabular-nums ${missing === 0 ? 'text-menu-accent' : 'text-white/70'}`}
              aria-live="polite"
            >
              {picked.length} de {board.meats}
              {missing === 0 ? ' ✓' : ''}
            </span>
          </div>

          {/* Los huecos: cuál se está eligiendo y qué tiene cada uno. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {meats.map((meat, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={index === active}
                onClick={() => setActive(index)}
                className={`flex min-h-10 items-center gap-2 rounded-2xl px-3 py-2 text-sm leading-none font-semibold transition-colors ${
                  index === active
                    ? 'bg-menu-accent/15 text-white ring-2 ring-menu-accent'
                    : 'bg-white/[0.06] text-white/80 ring-1 ring-white/20 hover:bg-white/10'
                }`}
              >
                <span className="font-menu-dish text-lg leading-none text-menu-accent">{index + 1}</span>
                {meat ? meat.name : <span className="text-white/50">Elegir</span>}
              </button>
            ))}
          </div>

          <p className="mt-4 text-[0.68rem] font-semibold tracking-[0.2em] text-white/55 uppercase">
            Carne {active + 1}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {BOARD_MEATS.map((meat) => {
              const times = chosen.filter((id) => id === meat.id).length;
              return (
                <Chip
                  key={meat.id}
                  selected={chosen[active] === meat.id}
                  onClick={() => pick(meat)}
                  ariaLabel={`Poner ${meat.name} en la carne ${active + 1}`}
                >
                  {meat.name}
                  {times > 0 ? <Badge>×{times}</Badge> : null}
                </Chip>
              );
            })}
          </div>
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              className="mt-3 text-xs font-semibold text-white/55 underline underline-offset-4 hover:text-white"
            >
              Vaciar la tabla
            </button>
          ) : null}
        </div>

        <Description>Arroz, plátano, salsa de ajo y limón. {board.meats} carnes a elección.</Description>
        <PriceRow
          price={board.price}
          missing={missing > 0 ? (missing === 1 ? 'Falta 1 carne' : `Faltan ${missing} carnes`) : null}
          onAdd={() => cart.add(line, board.price)}
          addLabel={`Agregar ${board.name}`}
          inCart={missing === 0 ? cart.quantity(line) : 0}
        />
      </div>
    </article>
  );
}

// ── Piezas: las mismas formas que `ProductCard` ─────────────────────────────

/** El título de una sección, como en la carta, con la descripción de su categoría debajo. */
export function SectionTitle({ label, description }: { label: string; description?: string }) {
  return (
    <header className="pt-14 pb-7 text-center">
      <h2 className="font-menu-title text-[clamp(1.75rem,9.2vw,3.5rem)] leading-none break-words text-menu-cream uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.65)]">
        {label}
      </h2>
      <span className="mx-auto mt-4 block h-1 w-16 rounded-full bg-menu-accent" aria-hidden />
      {description ? (
        <p className="mx-auto mt-4 max-w-sm text-sm leading-snug text-white/75">{description}</p>
      ) : null}
    </header>
  );
}

function DishTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-menu-dish text-[2.5rem] leading-[0.95] font-extrabold text-menu-accent">{children}</h3>
  );
}

function Description({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-snug text-white/85">{children}</p>;
}

function OptionGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="mt-3">
      <legend className="text-[0.68rem] font-semibold tracking-[0.2em] text-white/55 uppercase">{legend}</legend>
      <div role="radiogroup" aria-label={legend} className="mt-2 flex flex-wrap gap-2">
        {children}
      </div>
    </fieldset>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  radio = false,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  radio?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm leading-none font-semibold transition-colors ${
        selected
          ? 'bg-menu-accent text-menu-night shadow-md shadow-black/40'
          : 'bg-white/[0.08] text-white ring-1 ring-white/20 hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-menu-night/85 px-1.5 py-0.5 text-[0.7rem] text-menu-accent tabular-nums">
      {children}
    </span>
  );
}

function PriceRow({
  price,
  missing,
  onAdd,
  addLabel,
  inCart,
}: {
  price: number | null;
  /** Por qué todavía no se puede agregar; `null` = se puede. */
  missing: string | null;
  onAdd: () => void;
  addLabel: string;
  /** Cuántas de ESTA elección ya están en el pedido. */
  inCart: number;
}) {
  return (
    <div className="mt-3 flex items-end justify-between gap-3">
      <p className="flex shrink-0 items-baseline gap-2">
        <span className="font-menu-dish text-lg font-semibold text-menu-accent">Precio</span>
        <span className="text-[1.9rem] leading-none font-bold whitespace-nowrap text-white tabular-nums">
          {price === null ? '—' : formatMoney(price)}
        </span>
      </p>
      <div className="flex items-center gap-3">
        {missing ? <span className="text-right text-xs font-semibold text-white/60">{missing}</span> : null}
        <AddButton onClick={onAdd} disabled={missing !== null} label={addLabel} inCart={inCart} />
      </div>
    </div>
  );
}

/** El «+» de la carta. Con algo de esto en el pedido, lleva cuántos en una pastilla. */
export function AddButton({
  onClick,
  label,
  inCart,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  inCart: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-menu-accent/25 text-3xl leading-none font-light text-menu-accent ring-1 ring-menu-accent/60 transition-transform hover:bg-menu-accent/35 active:scale-90 disabled:opacity-35 disabled:active:scale-100"
    >
      +
      {inCart > 0 ? (
        <span
          className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-menu-accent px-1.5 text-xs font-bold text-menu-night tabular-nums"
          aria-label={`${inCart} en el pedido`}
        >
          {inCart}
        </span>
      ) : null}
    </button>
  );
}
