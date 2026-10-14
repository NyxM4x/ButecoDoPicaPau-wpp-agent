import type { Metadata } from "next";
import { Geist, Geist_Mono, Grenze_Gotisch, Poppins, Rye } from "next/font/google";
import "./globals.css";
import { RestaurantProfileProvider } from "@/components/RestaurantProfileProvider";
import { ensureRestaurantProfile } from "@/lib/restaurant/profile-loader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Las tres tipografías de la carta del menú (2026-10-13). Se registran aquí
 * como variables, igual que Geist, pero solo pintan donde se piden:
 * `font-menu-title` (el nombre de cada sección), `font-menu-dish` (el de cada
 * plato) y `font-menu-body` (lo que se lee de corrido, y los precios). El
 * dashboard y el resto del sitio no las usan.
 */
const rye = Rye({
  variable: "--font-rye",
  subsets: ["latin"],
  weight: "400",
});

// Sin `weight`: es una fuente variable y se pide entera. Pidiendo pesos sueltos
// (600 y 800), Google la entrega con una dirección que Turbopack no sabe leer
// y la página deja de compilar.
const grenzeGotisch = Grenze_Gotisch({
  variable: "--font-grenze",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await ensureRestaurantProfile();
  return {
    title: `${name} — Pedidos`,
    description: `Pedidos por WhatsApp de ${name}.`,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // El perfil del restaurante se lee una vez aquí y viaja al navegador: de él
  // salen el nombre, la moneda y el horario que pintan los componentes.
  const profile = await ensureRestaurantProfile();
  return (
    <html
      lang={profile.locale.split('-')[0] || 'es'}
      className={`${geistSans.variable} ${geistMono.variable} ${rye.variable} ${grenzeGotisch.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RestaurantProfileProvider profile={profile}>{children}</RestaurantProfileProvider>
      </body>
    </html>
  );
}
