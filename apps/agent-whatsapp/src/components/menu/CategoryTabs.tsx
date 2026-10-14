'use client';

import { useEffect, useRef } from 'react';

export interface MenuSectionLink {
  /** El `id` de la sección en la página. */
  id: string;
  label: string;
}

/**
 * Las secciones de la carta, en la barra fija de arriba.
 *
 * No filtran: llevan. La carta es una sola página y cada pestaña baja hasta su
 * sección; al desplazarse a mano, la pestaña marcada cambia sola (lo decide
 * `MenuStore`, que es quien mira por dónde va la pantalla). Así el cliente
 * nunca se queda viendo «solo bebidas» sin saber cómo volver a la comida.
 *
 * Las etiquetas salen del catálogo: aquí no hay ninguna escrita.
 */
export function CategoryTabs({
  sections,
  active,
  onSelect,
}: {
  sections: ReadonlyArray<MenuSectionLink>;
  /** La sección que se está viendo, o `null` arriba del todo. */
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  /*
   * La pestaña marcada se mantiene a la vista: con siete secciones, la quinta
   * queda fuera de una pantalla de celular.
   *
   * Se mueve la barra con `scrollTo` y no la pestaña con `scrollIntoView`: lo
   * segundo, en Chrome, corta el desplazamiento suave de la PÁGINA que el
   * propio toque acaba de iniciar, y la carta se quedaba a medio camino.
   */
  useEffect(() => {
    const nav = navRef.current;
    const tab = activeRef.current;
    if (!nav || !tab) return;
    nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Secciones del menú"
      className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {sections.map((section) => {
        const selected = section.id === active;
        return (
          <a
            key={section.id}
            ref={selected ? activeRef : undefined}
            href={`#${section.id}`}
            aria-current={selected ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onSelect(section.id);
            }}
            className={`font-menu-body shrink-0 border-b-2 px-3 py-3 text-[0.82rem] font-bold tracking-wide whitespace-nowrap uppercase transition-colors ${
              selected
                ? 'border-menu-accent text-menu-accent'
                : 'border-transparent text-white/75 hover:text-white'
            }`}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
