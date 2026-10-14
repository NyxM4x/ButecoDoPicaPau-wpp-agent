'use client';

import Image from 'next/image';
import { useState } from 'react';
// Formatter monetario de presentación compartido (puro): `Bs 45,00`.
import { formatMoney } from '@/lib/dashboard/format';
import { productDescription, productImage } from '@/lib/menu/catalog';
import { defaultOption, samePrice, type VariantOption } from '@/lib/menu/variants';
import { QuantityControl } from './QuantityControl';
import { Reveal } from './Reveal';

/** La forma de la caja de la foto (ancho / alto): antes de cargar, y sus topes. */
const DEFAULT_PHOTO_RATIO = 2;
/** Más alta que esto se comería la pantalla entera del celular. */
const MIN_PHOTO_RATIO = 1.2;
const MAX_PHOTO_RATIO = 3.4;

/**
 * Un plato de la carta: la foto grande, el nombre, qué trae, el precio y el «+».
 *
 * ── Un plato puede tener opciones ───────────────────────────────────────────
 *
 * La «Tabla» se sirve con seis carnes y las mismas guarniciones. Son seis
 * productos en el POS, pero aquí son UNA tarjeta: el cliente elige la carne y
 * la foto, la descripción y el precio cambian con ella. Seis tarjetas casi
 * iguales harían la carta el triple de larga para decir lo mismo. Cómo se
 * agrupan: `lib/menu/variants`.
 *
 * Con una sola opción es un plato normal, sin nada que elegir.
 *
 * ── Con foto y sin foto ─────────────────────────────────────────────────────
 *
 * Con foto, el plato ocupa el ancho y la foto entra creciendo al llegar a la
 * pantalla (`Reveal`). Sin foto —una gaseosa, por ejemplo— es una fila
 * compacta: reservarle el hueco de una foto que no existe sería media pantalla
 * vacía por cada bebida.
 */
export function ProductCard({
  title,
  options,
  quantityOf,
  onAdd,
  onRemove,
}: {
  /** El nombre del plato: el del producto, o lo que sus opciones tienen en común. */
  title: string;
  /** Una sola = plato sin elección. */
  options: VariantOption[];
  quantityOf: (code: string) => number;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const [chosenCode, setChosenCode] = useState<string | null>(null);
  /** Fotos que fallaron al cargar: ese plato pasa a la fila compacta. */
  const [brokenPhotos, setBrokenPhotos] = useState<ReadonlySet<string>>(new Set());
  /**
   * La proporción real de cada foto (ancho / alto), una vez cargada.
   *
   * Las fotos llegan del POS sin medidas, y no todas tienen la misma forma: una
   * tabla es tres veces más ancha que alta, un plato hondo es casi cuadrado.
   * Con una caja fija, la tabla quedaría flotando en medio de un hueco. Así la
   * caja toma la forma de su foto.
   */
  const [photoRatios, setPhotoRatios] = useState<Readonly<Record<string, number>>>({});

  // Si la opción elegida deja de existir (el POS la retiró), vuelve la primera.
  const option = options.find((o) => o.item.code === chosenCode) ?? defaultOption(options);
  const item = option.item;
  const hasChoice = options.length > 1;
  const showOptionPrices = hasChoice && !samePrice(options);

  const description = productDescription(item);
  const available = item.is_active;
  const quantity = quantityOf(item.code);
  const inCart = quantity > 0;
  const src = productImage(item).src;
  const photo = src !== null && !brokenPhotos.has(item.code) ? src : null;

  return (
    /*
     * `z-0` encierra el apilado de la tarjeta: la foto lleva sombra y se monta
     * sobre el texto de SU plato, nunca sobre la barra de secciones.
     */
    <article className={`relative z-0 flex flex-col ${photo ? '' : 'justify-center'}`}>
      {photo ? (
        // En el celular la foto se sale un poco de su columna, casi hasta el
        // borde (la página deja 16 px; aquí se recuperan 12); desde tablet se
        // queda dentro.
        <Reveal className="relative -mx-3 mb-3 sm:mx-0">
          <div
            className="relative mx-auto w-full max-w-lg"
            // Antes de cargar, la forma de una foto apaisada: es la más común.
            style={{ aspectRatio: photoRatios[item.code] ?? DEFAULT_PHOTO_RATIO }}
          >
          <Image
            // Con otra opción la foto es otra: se monta de nuevo y entra con su gesto.
            key={item.code}
            src={photo}
            alt={item.name}
            fill
            sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
            // Las fotos del POS llegan por una ruta propia que ya las sirve con
            // caché: pasarlas además por el optimizador las pediría dos veces.
            unoptimized={photo.startsWith('/api/')}
            className={`menu-swap object-contain drop-shadow-[0_24px_22px_rgba(0,0,0,0.7)] ${
              available ? '' : 'opacity-60 grayscale'
            }`}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                const ratio = Math.min(MAX_PHOTO_RATIO, Math.max(MIN_PHOTO_RATIO, naturalWidth / naturalHeight));
                setPhotoRatios((ratios) => (ratios[item.code] === ratio ? ratios : { ...ratios, [item.code]: ratio }));
              }
            }}
            onError={() => setBrokenPhotos((broken) => new Set(broken).add(item.code))}
          />
          </div>
        </Reveal>
      ) : null}

      <div
        className={
          photo ? 'px-1' : 'rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-sm'
        }
      >
        <h3
          className={`font-menu-dish line-clamp-2 leading-[0.95] font-extrabold text-menu-accent ${
            photo ? 'text-[2.5rem]' : 'text-3xl'
          }`}
        >
          {title}
        </h3>

        {hasChoice ? (
          <fieldset className="mt-3">
            <legend className="text-[0.68rem] font-semibold tracking-[0.2em] text-white/55 uppercase">
              Elige tu opción
            </legend>
            <div role="radiogroup" aria-label={`Opciones de ${title}`} className="mt-2 flex flex-wrap gap-2">
              {options.map((o) => {
                const selected = o.item.code === item.code;
                const units = quantityOf(o.item.code);
                return (
                  <button
                    key={o.item.code}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!o.item.is_active}
                    onClick={() => setChosenCode(o.item.code)}
                    className={`flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm leading-none font-semibold transition-colors disabled:line-through disabled:opacity-40 ${
                      selected
                        ? 'bg-menu-accent text-menu-night shadow-md shadow-black/40'
                        : 'bg-white/[0.08] text-white ring-1 ring-white/20 hover:bg-white/15'
                    }`}
                  >
                    {o.label}
                    {showOptionPrices ? (
                      <span className={`tabular-nums ${selected ? 'text-menu-night/70' : 'text-white/55'}`}>
                        {formatMoney(o.item.price)}
                      </span>
                    ) : null}
                    {units > 0 ? (
                      /* Lo que ya está en el carrito se ve sin tener que elegirlo de nuevo. */
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[0.7rem] tabular-nums ${
                          selected ? 'bg-menu-night/85 text-menu-accent' : 'bg-menu-accent text-menu-night'
                        }`}
                        aria-label={`${units} en el carrito`}
                      >
                        ×{units}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {description ? (
          <p className="font-menu-body mt-2 line-clamp-4 text-sm leading-snug text-white/85">{description}</p>
        ) : null}

        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <span className="font-menu-dish text-lg font-semibold text-menu-accent">Precio</span>
            {/*
             * La plata va en la letra de leer, no en la del nombre: una cifra
             * tiene que entenderse de un vistazo, y `tabular-nums` deja todos
             * los precios alineados entre un plato y otro.
             */}
            <span className="font-menu-body text-[1.9rem] leading-none font-bold text-white tabular-nums">
              {formatMoney(item.price)}
            </span>
          </p>

          {!available ? (
            /* La misma palabra que usa el POS al retirarlo y la que dice el local por WhatsApp. */
            <span className="rounded-full bg-black/40 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/20">
              Agotado
            </span>
          ) : inCart ? (
            <QuantityControl
              name={item.name}
              quantity={quantity}
              onAdd={() => onAdd(item.code)}
              onRemove={() => onRemove(item.code)}
              tone="inverse"
            />
          ) : (
            <button
              type="button"
              onClick={() => onAdd(item.code)}
              aria-label={`Agregar ${item.name} al carrito`}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-menu-accent/25 text-3xl leading-none font-light text-menu-accent ring-1 ring-menu-accent/60 transition-transform hover:bg-menu-accent/35 active:scale-90"
            >
              +
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
