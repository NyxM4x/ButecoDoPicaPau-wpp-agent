'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BoardStage } from '@/components/menu/BoardStage';
import { CategoryTabs } from '@/components/menu/CategoryTabs';
import { ReservationSection } from '@/components/menu/ReservationSection';
import { BOARD_MEATS, BOARD_LAYOUTS, type BoardMeat } from '@/lib/menu/board-layers';
import { SectionTitle, ShareBoardCard, TablitaCard } from './BoardCards';
import {
  BIRTHDAY_COMBOS,
  BIRTHDAY_CONDITION,
  DRINKS,
  EXTRAS,
  MODES,
  SECTION_TABS,
  SHARE_BOARDS,
  modeById,
  type BirthdayCombo,
  type MockupMode,
  type MockupModeId,
  type MockupSectionId,
} from './data';
import { ItemRow } from './ItemRow';
import { MockCartProvider } from './mock-cart';

const FORM_ID = 'reserva-formulario';

const meat = (id: string): BoardMeat => BOARD_MEATS.find((item) => item.id === id) ?? BOARD_MEATS[0];

function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** La dirección de una opción, sin perder lo demás que traiga (la `session` del bot). */
function hrefFor(mode: MockupModeId | null, search: string): string {
  const query = new URLSearchParams(search);
  if (mode) query.set('ver', mode);
  else query.delete('ver');
  const text = query.toString();
  return text ? `?${text}` : '?';
}

/**
 * La carta de la maqueta: primero una bienvenida con tres opciones grandes, y
 * cada una abre SOLO lo suyo (con sus bebidas y extras). Juntarlo todo en una
 * página era un recorrido eterno para el cliente.
 *
 * La opción va en la dirección (`?ver=para-compartir`), no en la memoria:
 * el «atrás» del celular vuelve a la bienvenida, y el bot puede mandar el
 * enlace directo a una opción. Se cambia con `history.pushState`, que Next
 * entiende (`useSearchParams` se entera), sin volver a pedir la página.
 */
export function MockupMenu({
  restaurantName,
  logoUrl,
  chatUrl,
}: {
  restaurantName: string;
  logoUrl: string | null;
  chatUrl: string | null;
}) {
  const params = useSearchParams();
  const mode = modeById(params.get('ver'));

  function choose(next: MockupModeId | null) {
    window.history.pushState(null, '', hrefFor(next, window.location.search));
    window.scrollTo({ top: 0 });
  }

  return (
    // El pedido sigue al cambiar de opción: una tablita y después una bebida.
    <MockCartProvider showBar={mode !== null && mode.id !== 'reservar'}>
      {mode ? (
        <ModeView key={mode.id} mode={mode} chatUrl={chatUrl} onChoose={choose} />
      ) : (
        <Welcome restaurantName={restaurantName} logoUrl={logoUrl} onChoose={choose} />
      )}
    </MockCartProvider>
  );
}

// ── La bienvenida ───────────────────────────────────────────────────────────

function Welcome({
  restaurantName,
  logoUrl,
  onChoose,
}: {
  restaurantName: string;
  logoUrl: string | null;
  onChoose: (mode: MockupModeId) => void;
}) {
  return (
    <section
      aria-label="Bienvenida"
      className="relative mx-auto flex min-h-[calc(100svh-3.25rem)] max-w-md flex-col items-center overflow-hidden px-5 pt-10 text-center"
    >
      {logoUrl ? (
        // El logo puede venir de cualquier dominio (lo configura cada local).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={restaurantName} className="h-28 w-auto max-w-[70%] object-contain" />
      ) : (
        <p className="font-menu-dish text-[clamp(2.4rem,12vw,3.6rem)] leading-[0.88] font-extrabold text-menu-accent drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">
          {restaurantName}
        </p>
      )}
      <h1 className="font-menu-title mt-6 text-[clamp(2rem,10vw,3rem)] leading-none text-menu-cream uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.65)]">
        ¡Bienvenido!
      </h1>
      <p className="mt-3 text-sm text-white/80">Elige cómo quieres disfrutar hoy</p>

      <nav aria-label="Qué quieres hacer" className="mt-6 flex w-full flex-col gap-3">
        {MODES.map((mode) => (
          <a
            key={mode.id}
            href={hrefFor(mode.id, '')}
            onClick={(event) => {
              event.preventDefault();
              onChoose(mode.id);
            }}
            className="flex w-full items-center gap-4 rounded-2xl bg-black/40 p-3.5 text-left ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-black/55 hover:ring-menu-accent/50 active:scale-[0.98]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-menu-accent">
              <ModeIcon mode={mode.id} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] leading-tight font-bold tracking-wide text-white uppercase">
                {mode.title}
              </span>
              <span className="mt-1 block text-xs leading-snug text-menu-accent">{mode.subtitle}</span>
            </span>
            <span className="text-2xl leading-none text-white/40" aria-hidden>
              ›
            </span>
          </a>
        ))}
      </nav>
      <p className="mt-5 text-xs text-white/55">Cambia de opción cuando quieras.</p>

      {/* El plato asoma por abajo, como una invitación. */}
      <div className="pointer-events-none mt-auto -mb-[14%] w-[118%] max-w-none pt-6" aria-hidden>
        <BoardStage
          layout={BOARD_LAYOUTS.three}
          meats={[meat('chicharron-de-pescado'), meat('biffe'), meat('costilla-res')]}
          label=""
        />
      </div>
    </section>
  );
}

function ModeIcon({ mode, className = 'h-6 w-6' }: { mode: MockupModeId; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    className,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (mode === 'para-1-y-2') {
    // Un plato con cubiertos.
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="3" />
        <path d="M2.5 4v4.5a1.5 1.5 0 0 0 3 0V4M4 9v11M21.5 4c-1.3 0-2.3 2-2.3 4.5V12h2.3v8" />
      </svg>
    );
  }
  if (mode === 'para-compartir') {
    // Un grupo.
    return (
      <svg {...common}>
        <circle cx="9.5" cy="8" r="3.2" />
        <path d="M3.5 19v-1.2A3.8 3.8 0 0 1 7.3 14h4.4a3.8 3.8 0 0 1 3.8 3.8V19" />
        <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M18 14.2a3.8 3.8 0 0 1 2.5 3.6V19" />
      </svg>
    );
  }
  // Un calendario con la fecha marcada.
  return (
    <svg {...common}>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

// ── Una opción por dentro ───────────────────────────────────────────────────

function ModeView({
  mode,
  chatUrl,
  onChoose,
}: {
  mode: MockupMode;
  chatUrl: string | null;
  onChoose: (mode: MockupModeId | null) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [presetNote, setPresetNote] = useState<{ text: string; serial: number } | null>(null);

  // La pestaña marcada sigue a la sección que cruza la pantalla, como en la carta.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossing.add(entry.target.id);
          else crossing.delete(entry.target.id);
        }
        setActive(mode.sections.find((id) => crossing.has(id)) ?? null);
      },
      { rootMargin: '-32% 0px -66% 0px' },
    );
    for (const id of mode.sections) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [mode]);

  function reserveWith(combo: BirthdayCombo) {
    setPresetNote((current) => ({ text: combo.note, serial: (current?.serial ?? 0) + 1 }));
    goTo(FORM_ID);
  }

  const others = MODES.filter((other) => other.id !== mode.id);

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-white/10 bg-menu-night/90 shadow-lg shadow-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-1 pr-2 pl-3 pt-[env(safe-area-inset-top)]">
          <button
            type="button"
            onClick={() => onChoose(null)}
            aria-label="Volver a elegir"
            className="flex h-10 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-sm font-bold text-white/80 ring-1 ring-white/15 hover:text-white"
          >
            <span className="text-xl leading-none" aria-hidden>
              ‹
            </span>
            Inicio
          </button>
          <CategoryTabs
            sections={mode.sections.map((id) => ({ id, label: SECTION_TABS[id] }))}
            active={active}
            onSelect={goTo}
          />
        </div>
      </div>

      <header className="px-6 pt-10 text-center">
        <h1 className="font-menu-title text-[clamp(1.75rem,9.2vw,3.5rem)] leading-none break-words text-menu-cream uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.65)]">
          {mode.title}
        </h1>
        <span className="mx-auto mt-4 block h-1 w-16 rounded-full bg-menu-accent" aria-hidden />
        <p className="mx-auto mt-4 max-w-sm text-sm leading-snug text-white/75">{mode.description}</p>
        {/* Las otras dos, a un toque: sin volver al inicio. */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {others.map((other) => (
            <a
              key={other.id}
              href={hrefFor(other.id, '')}
              onClick={(event) => {
                event.preventDefault();
                onChoose(other.id);
              }}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-white/80 ring-1 ring-white/15 hover:text-white"
            >
              <span className="text-menu-accent">
                <ModeIcon mode={other.id} className="h-4 w-4" />
              </span>
              {other.title}
              <span aria-hidden>›</span>
            </a>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pb-40">
        {mode.sections.map((id, index) => (
          <section key={id} id={id} aria-label={SECTION_TABS[id]} className="scroll-mt-14">
            {/* La primera ya tiene título: el de la opción. */}
            {index > 0 && id !== 'cumpleanos' ? <SectionTitle label={SECTION_TABS[id]} /> : <div className="h-8" />}
            <SectionBody id={id} chatUrl={chatUrl} presetNote={presetNote} onReserve={reserveWith} />
          </section>
        ))}
      </div>
    </>
  );
}

function SectionBody({
  id,
  chatUrl,
  presetNote,
  onReserve,
}: {
  id: MockupSectionId;
  chatUrl: string | null;
  presetNote: { text: string; serial: number } | null;
  onReserve: (combo: BirthdayCombo) => void;
}): ReactNode {
  switch (id) {
    case 'tablitas':
      return (
        <div className="mx-auto max-w-lg">
          <TablitaCard />
        </div>
      );
    case 'compartir':
      return (
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-16">
          {SHARE_BOARDS.map((board) => (
            <div key={board.id} className="w-full max-w-lg">
              <ShareBoardCard board={board} />
            </div>
          ))}
        </div>
      );
    case 'bebidas':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {DRINKS.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </div>
      );
    case 'extras':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {EXTRAS.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
          <p className="flex items-center justify-center rounded-3xl border border-dashed border-white/20 px-4 py-5 text-center text-xs leading-relaxed text-white/50">
            Aquí van los demás extras del local (porciones, salsas…): falta la lista y sus precios.
          </p>
        </div>
      );
    case 'reserva':
      return (
        <div id={FORM_ID} className="scroll-mt-20">
          <ReservationSection chatUrl={chatUrl} presetNote={presetNote} />
        </div>
      );
    case 'cumpleanos':
      return <BirthdayCombos onReserve={onReserve} />;
  }
}

/**
 * Los combos de cumpleaños: para informar. No van al carrito; el botón de
 * cada uno sube al formulario con la reserva ya marcada como cumpleaños.
 */
function BirthdayCombos({ onReserve }: { onReserve: (combo: BirthdayCombo) => void }) {
  return (
    <div className="pt-8">
      <div className="text-center">
        <span className="text-4xl leading-none" aria-hidden>
          🎂
        </span>
        <h2 className="font-menu-dish mt-2 text-[2.5rem] leading-[0.95] font-extrabold text-menu-accent">
          ¿Cumpleaños?
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-snug text-white/75">
          Te lo celebramos. Elige tu combo y pide la reserva: te confirmamos por WhatsApp.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {BIRTHDAY_COMBOS.map((combo) => (
          <div
            key={combo.id}
            className="flex flex-col rounded-3xl border border-menu-accent/30 bg-menu-surface/85 p-5 shadow-lg shadow-black/40 backdrop-blur-sm"
          >
            <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-menu-accent uppercase">{combo.people}</p>
            <h3 className="font-menu-dish mt-1 text-3xl leading-none font-extrabold text-menu-cream">{combo.name}</h3>
            <p className="mt-1.5 text-sm leading-snug text-white/70">{combo.boards}</p>
            <ul className="mt-4 grid grid-cols-1 gap-x-3 gap-y-1.5 text-sm text-white/90 min-[400px]:grid-cols-2">
              {combo.includes.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-menu-accent" aria-hidden>
                    <path d="M8.1 14.6 3.5 10l1.4-1.4 3.2 3.2 7-7 1.4 1.4z" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onReserve(combo)}
              className="mt-5 rounded-full bg-menu-accent/20 px-5 py-3 text-sm font-bold text-menu-accent ring-1 ring-menu-accent/60 transition-transform hover:bg-menu-accent/30 active:scale-[0.98] sm:mt-auto"
            >
              Reservar con este combo
            </button>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-white/55">{BIRTHDAY_CONDITION}</p>
    </div>
  );
}
