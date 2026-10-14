'use client';

import Image from 'next/image';
import { useState } from 'react';
import {
  BOARD_BASE,
  BOARD_BASE_HEIGHT,
  BOARD_STAGE_RATIO,
  placeSlot,
  type BoardMeat,
  type MeatSlot,
} from '@/lib/menu/board-layers';

/**
 * La tabla por capas: la base fija y, encima, una carne recortada por hueco
 * (2026-10-13, prototipo). Dónde va cada hueco: `lib/menu/board-layers`.
 *
 * Al cambiar una carne, la que estaba se levanta y la nueva cae en su sitio.
 * Un hueco sin elegir muestra su número sobre la tabla, para que se vea dónde
 * va a caer.
 *
 * Al cambiar de acomodo con el mismo número de huecos (tablita para 1 → para
 * 2), la carne no se vuelve a montar: crece en su sitio.
 */
export function BoardStage({
  layout,
  meats,
  activeSlot = null,
  label,
}: {
  layout: readonly MeatSlot[];
  /** Una por hueco, en el mismo orden. `null`: todavía sin elegir. */
  meats: readonly (BoardMeat | null)[];
  /** El hueco que se está eligiendo: su número se resalta. */
  activeSlot?: number | null;
  /** Lo que se ve, para quien no lo ve: «Tabla de Zeus con biffe y costilla». */
  label: string;
}) {
  return (
    <div role="img" aria-label={label} className="relative w-full" style={{ aspectRatio: BOARD_STAGE_RATIO }}>
      <Image
        src={BOARD_BASE.src}
        alt=""
        width={BOARD_BASE.width}
        height={BOARD_BASE.height}
        sizes="(min-width: 640px) 512px, 100vw"
        priority
        className="absolute bottom-0 left-0 w-full drop-shadow-[0_24px_22px_rgba(0,0,0,0.7)]"
        style={{ height: `${BOARD_BASE_HEIGHT}%` }}
      />
      {layout.map((slot, index) => (
        <MeatLayer
          // Por hueco, no por carne: así el hueco recuerda qué carne tenía y
          // puede despedirla al cambiarla.
          key={index}
          slot={slot}
          meat={meats[index] ?? null}
          number={index + 1}
          active={activeSlot === index}
        />
      ))}
    </div>
  );
}

/** Un hueco de la tabla: su carne, la que se está yendo y, si está vacío, su número. */
function MeatLayer({
  slot,
  meat,
  number,
  active,
}: {
  slot: MeatSlot;
  meat: BoardMeat | null;
  number: number;
  active: boolean;
}) {
  const box = placeSlot(slot);
  // La carne que se está mostrando y las que se están yendo. Se actualiza
  // durante el render (no en un efecto) para que la nueva y la vieja aparezcan
  // en el mismo cuadro: con un efecto habría un parpadeo sin ninguna.
  const [shown, setShown] = useState(meat);
  const [leaving, setLeaving] = useState<readonly { key: number; meat: BoardMeat }[]>([]);
  const [serial, setSerial] = useState(0);
  if ((meat?.id ?? null) !== (shown?.id ?? null)) {
    if (shown) {
      setLeaving([...leaving, { key: serial, meat: shown }]);
      setSerial(serial + 1);
    }
    setShown(meat);
  }

  return (
    <div
      className="board-slot absolute"
      style={{ left: `${box.left}%`, bottom: `${box.bottom}%`, width: `${box.width}%`, zIndex: box.z }}
    >
      {shown === null ? (
        <span
          aria-hidden
          className={`absolute inset-x-[14%] bottom-0 flex aspect-[2.4/1] translate-y-[30%] items-center justify-center rounded-[50%] border-2 border-dashed font-menu-dish text-2xl leading-none font-extrabold transition-colors ${
            active
              ? 'board-marker-active border-menu-accent bg-menu-accent/25 text-menu-accent'
              : 'border-menu-cream/45 bg-black/35 text-menu-cream/70'
          }`}
        >
          {number}
        </span>
      ) : null}

      {leaving.map((out) => (
        <MeatPiece
          key={`out-${out.key}`}
          meat={out.meat}
          leaving
          onGone={() => setLeaving((list) => list.filter((item) => item.key !== out.key))}
        />
      ))}
      {shown ? <MeatPiece key={shown.id} meat={shown} /> : null}
    </div>
  );
}

/** Una carne con su sombra sobre la tabla. */
function MeatPiece({ meat, leaving = false, onGone }: { meat: BoardMeat; leaving?: boolean; onGone?: () => void }) {
  return (
    <div
      className={leaving ? 'board-out' : 'board-in relative'}
      // La sombra y la carne terminan casi a la vez; con la primera basta.
      onAnimationEnd={leaving ? onGone : undefined}
    >
      {/* La sombra donde la carne toca la madera: sin ella parece pegada encima. */}
      <span className="board-shadow" aria-hidden />
      <Image
        src={meat.src}
        alt=""
        width={meat.width}
        height={meat.height}
        sizes="(min-width: 640px) 210px, 40vw"
        className="board-meat relative block h-auto w-full"
      />
    </div>
  );
}
