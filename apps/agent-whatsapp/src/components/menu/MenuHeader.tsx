/**
 * La portada de la carta: el nombre del local a lo grande, qué es y dónde queda.
 *
 * Todo sale del perfil del restaurante; aquí no hay ningún dato escrito. El
 * logo no va aquí sino en la barra fija (`MenuStore`), que es lo que acompaña
 * al cliente mientras recorre la carta.
 */
export function MenuHeader({
  restaurantName,
  tagline = null,
  address = null,
  mapsUrl = null,
}: {
  restaurantName: string;
  /** Qué vende y dónde, en una línea. */
  tagline?: string | null;
  address?: string | null;
  /** Enlace a la ubicación del local. Sin él, la dirección va como texto. */
  mapsUrl?: string | null;
}) {
  const bajada = tagline ? tagline.charAt(0).toUpperCase() + tagline.slice(1) : null;

  return (
    <header className="px-4 pt-10 pb-2 text-center">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-menu-dish text-[clamp(2.6rem,13vw,4.5rem)] leading-[0.88] font-extrabold text-menu-accent drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">
          {restaurantName}
        </h1>
        {bajada ? (
          <p className="font-menu-body mx-auto mt-3 max-w-sm text-sm leading-snug text-white/80">{bajada}</p>
        ) : null}
        {address ? (
          mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-menu-body mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-4 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15"
            >
              <PinIcon />
              {address}
            </a>
          ) : (
            <p className="font-menu-body mt-3 inline-flex items-center gap-1.5 text-xs text-white/65">
              <PinIcon />
              {address}
            </p>
          )
        ) : null}
        <p className="font-menu-body mt-4 text-xs text-white/55">
          Arma tu carrito y termina el pedido por WhatsApp.
        </p>
      </div>
    </header>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-menu-accent" aria-hidden>
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
    </svg>
  );
}
