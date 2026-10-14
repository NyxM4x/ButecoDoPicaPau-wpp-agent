'use client';

import Image from 'next/image';
import { useState } from 'react';
import { formatMoney } from '@/lib/dashboard/format';
import type { Promotion, PromotionPricing } from '@/lib/promotions/promotion';
import { expiryLabel } from '@/lib/promotions/promotion-display';
import { QuantityControl } from './QuantityControl';

/**
 * Un combo: varios productos juntos a un precio menor que por separado.
 *
 * Sirve igual para el combo fijo de la carta y para la promoción con fecha: la
 * única diferencia a la vista es la línea de «hasta cuándo», que solo sale si
 * el combo vence.
 *
 * ── Qué trae, renglón por renglón ───────────────────────────────────────────
 *
 * Un combo se compra por lo que incluye, así que eso va entero y en lista: no
 * en una frase recortada a dos líneas donde el tercer producto se pierde.
 *
 * ── El marco ────────────────────────────────────────────────────────────────
 *
 * El borde naranja tenue dice «esto es un combo»; el borde naranja lleno,
 * «esto está en tu carrito».
 */
export function PromoCard({
  promotion,
  pricing,
  quantity,
  now,
  imageSrc = null,
  onAdd,
  onRemove,
}: {
  promotion: Promotion;
  pricing: PromotionPricing;
  quantity: number;
  now: number;
  /** La foto del combo, o la de su producto principal. `null` = sin foto. */
  imageSrc?: string | null;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const [brokenPhoto, setBrokenPhoto] = useState(false);
  const enCarrito = quantity > 0;
  const vence = expiryLabel(promotion.endsAt, now);
  const photo = imageSrc !== null && !brokenPhoto ? imageSrc : null;

  return (
    <article
      className={`relative z-0 flex flex-col rounded-3xl border bg-menu-surface/85 p-4 shadow-lg shadow-black/40 backdrop-blur-sm transition-colors ${
        enCarrito ? 'border-menu-accent' : 'border-menu-accent/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-bold tracking-[0.2em] text-menu-accent uppercase">Combo</p>
          <h3 className="font-menu-dish mt-1 line-clamp-2 text-[2rem] leading-[0.95] font-extrabold text-menu-cream">
            {promotion.name}
          </h3>
        </div>
        {photo ? (
          <div className="relative -mt-1 h-20 w-28 shrink-0">
            <Image
              src={photo}
              alt=""
              fill
              sizes="112px"
              unoptimized={photo.startsWith('/api/')}
              className="object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.6)]"
              onError={() => setBrokenPhoto(true)}
            />
          </div>
        ) : null}
      </div>

      <ul className="font-menu-body mt-3 space-y-1 text-sm leading-snug text-white/85">
        {promotion.components.map((component) => (
          <li key={component.menuItemId} className="flex gap-2">
            <span className="font-semibold text-menu-accent tabular-nums">{component.quantity}×</span>
            <span className="min-w-0">{component.name}</span>
          </li>
        ))}
      </ul>

      {/* Sin vencimiento no se pinta nada: ni etiqueta, ni hueco reservado. */}
      {vence !== null && <p className="mt-2 text-xs font-medium text-amber-300">{vence}</p>}

      <div className="mt-4 flex items-end justify-between gap-2 border-t border-white/10 pt-3">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="font-menu-body text-[1.7rem] leading-none font-bold text-white tabular-nums">
              {formatMoney(pricing.promoPrice)}
            </span>
            <span className="text-sm text-white/45 line-through tabular-nums">
              {formatMoney(pricing.normalPrice)}
            </span>
          </p>
          <p className="mt-1 text-xs font-semibold text-emerald-300 tabular-nums">
            Ahorras {formatMoney(pricing.savings)}
          </p>
        </div>

        {enCarrito ? (
          <QuantityControl
            name={promotion.name}
            quantity={quantity}
            onAdd={onAdd}
            onRemove={onRemove}
            tone="inverse"
          />
        ) : (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Agregar el combo ${promotion.name} al carrito`}
            className="shrink-0 rounded-full bg-menu-accent px-5 py-3 text-sm font-bold text-menu-night shadow-lg shadow-black/30 transition-transform active:scale-95"
          >
            Agregar
          </button>
        )}
      </div>
    </article>
  );
}
