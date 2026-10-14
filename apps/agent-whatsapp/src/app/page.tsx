import Link from "next/link";
import { connection } from "next/server";
import { ensureRestaurantProfile } from "@/lib/restaurant/profile-loader";

export default async function Home() {
  // Sin esto Next prerenderiza la página al compilar y deja fijo el nombre que
  // hubiera en ese momento (o el de respaldo, si el POS no respondía).
  await connection();
  const { name } = await ensureRestaurantProfile();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight">{name} — Pedidos</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Sistema de pedidos por WhatsApp. Este es el panel interno del
        restaurante.
      </p>
      <Link
        href="/dashboard"
        className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        Ir al dashboard
      </Link>
      <p className="text-xs text-zinc-400">Fase 1 — Base (scaffolding)</p>
    </main>
  );
}
