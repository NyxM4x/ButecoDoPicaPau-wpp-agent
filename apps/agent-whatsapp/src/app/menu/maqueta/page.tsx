import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getServerEnv } from '@/lib/env/env';
import { businessChatUrl } from '@/lib/menu/whatsapp-chat';
import { ensureRestaurantProfile } from '@/lib/restaurant/profile-loader';
import { MockupMenu } from './MockupMenu';

export const metadata: Metadata = {
  title: 'Maqueta — La carta',
  robots: { index: false, follow: false },
};

/**
 * GET /menu/maqueta — cómo se vería la carta (2026-10-13 y 14).
 *
 * Una bienvenida con tres opciones (Tablitas para 1 y 2, Para compartir,
 * Reservar mesa), y cada una abre solo lo suyo, con bebidas y extras
 * (`?ver=…`). Las tablas se pintan por capas (`lib/menu/board-layers`). No lee
 * el POS ni deja pedir: los textos, platos y precios del volante están en
 * `data.ts`. La reserva es la de la carta real.
 *
 * Solo existe en desarrollo: en producción es un 404.
 */
export default async function BoardMockupPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const profile = await ensureRestaurantProfile();
  // Igual que en /menu: sin el número del local, la reserva se ve con el botón apagado.
  let chatUrl: string | null = null;
  try {
    chatUrl = businessChatUrl(getServerEnv().WHATSAPP_BUSINESS_NUMBER);
  } catch {
    chatUrl = null;
  }

  return (
    <main className="font-menu-body relative isolate flex-1 bg-menu-night text-white">
      <div className="menu-backdrop pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="menu-weave pointer-events-none fixed inset-y-0 left-0 z-0 w-2.5 sm:w-3.5" aria-hidden />
      <div className="relative z-10">
        <p className="bg-menu-accent px-4 py-2 text-center text-xs font-semibold text-menu-night">
          Maqueta: así se vería la carta. Precios del volante; desde aquí no se puede pedir.
        </p>
        {/* `useSearchParams` (la opción elegida) pide un borde de espera. */}
        <Suspense>
          <MockupMenu restaurantName={profile.name} logoUrl={profile.logoUrl} chatUrl={chatUrl} />
        </Suspense>
      </div>
    </main>
  );
}
