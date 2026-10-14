import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Tests de PRESENTACIÓN del menú (Fase 6B.1R). El entorno de test es `node`
 * (sin DOM), así que —igual que en el dashboard— se verifican por lectura del
 * fuente: son barreras contra regresiones visuales/estructurales, no un render.
 * NO tocan la lógica de carrito/checkout ni escriben en ningún sitio.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const comp = (name: string) => src(`./${name}.tsx`);

const DISPLAY_MONEY = ['ProductCard', 'CartButton', 'CartPanel', 'OrderSuccess', 'CheckoutPanel'];

describe('6B.1R — moneda Bs en la presentación del menú', () => {
  it('los componentes de vitrina usan formatMoney (Bs 45,00), no formatBs', () => {
    for (const c of DISPLAY_MONEY) {
      const s = comp(c);
      expect(s, c).toContain('formatMoney');
      expect(s, c).not.toContain('formatBs');
    }
  });

  it('ninguna cifra de plata usa una tipografía de adorno (18-09-2026)', () => {
    // Nació con Bangers, donde el 7 es casi un 1: la porción de papa a Bs 7 se
    // leía "Bs 1", y un pedido de Bs 71 leído como Bs 11 es una discusión en la
    // puerta. La regla sobrevive al cambio de carta: la plata va en la letra de
    // leer (`font-menu-body`), nunca en la de los nombres o los títulos.
    for (const c of ['ProductCard', 'PromoCard', 'CartPanel']) {
      const lineas = comp(c)
        .split('\n')
        .filter((l) => /font-menu-(dish|title)|font-display/.test(l) && /formatMoney|tabular-nums/.test(l));
      expect(lineas, `${c}: plata en una letra de adorno`).toEqual([]);
    }
    expect(comp('ProductCard')).toMatch(/font-menu-body[^"]*tabular-nums/);
  });
});

describe('6B.1R — ProductCard', () => {
  it('muestra nombre, precio y acción de agregar', () => {
    const s = comp('ProductCard');
    // El título es el nombre del plato: el del producto, o lo que tienen en
    // común sus opciones («Tabla»). Lo arma `MenuStore`.
    expect(s).toContain('{title}');
    expect(s).toContain('formatMoney(item.price)');
    expect(s).toContain('Agregar');
    expect(s).toContain('aria-label={`Agregar ${item.name} al carrito`}');
  });

  it('controla nombres y descripciones largas con line-clamp', () => {
    const s = comp('ProductCard');
    // El nombre se recorta a dos líneas, en la letra de los platos.
    expect(s).toMatch(/font-menu-dish line-clamp-2/);
    // La descripción tiene más aire que antes (la tarjeta ocupa el ancho), pero
    // sigue con tope: una descripción de un párrafo no empuja el precio fuera.
    expect(s).toMatch(/line-clamp-4 text-sm/);
  });

  it('un plato con opciones las ofrece como una elección única, accesible', () => {
    const s = comp('ProductCard');
    expect(s).toContain('role="radiogroup"');
    expect(s).toContain('role="radio"');
    expect(s).toContain('aria-checked={selected}');
    // La opción agotada se ve, tachada, pero no se puede elegir.
    expect(s).toContain('disabled={!o.item.is_active}');
    // Sin nada que elegir no hay selector: un plato normal no lleva un botón solo.
    expect(s).toMatch(/hasChoice \? \(\s*<fieldset/);
    // Lo que se agrega es la opción ELEGIDA, con su código y su nombre completo.
    expect(s).toContain('onAdd(item.code)');
  });

  it('la foto entra creciendo una sola vez, y respeta a quien pidió menos movimiento', () => {
    expect(comp('ProductCard')).toContain('<Reveal');
    const reveal = comp('Reveal');
    expect(reveal).toContain('IntersectionObserver');
    expect(reveal).toContain('observer.disconnect()'); // una sola vez
    const css = src('../../app/globals.css');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.menu-reveal\s*{[\s\S]*transform: none/);
    // Sin JavaScript nadie avisa que la foto llegó: la página la muestra de una.
    expect(src('../../app/menu/page.tsx')).toContain('<noscript>');
  });

  it('un producto agotado no ofrece CTA activo', () => {
    const s = comp('ProductCard');
    expect(s).toContain('item.is_active');
    // "Agotado" y no "No disponible" (07-09-2026): es la palabra del panel y la
    // que dice el negocio. Desde que la vitrina los enseña en vez de
    // esconderlos, esta etiqueta la ve el cliente de verdad.
    expect(s).toContain('Agotado');
    // La disponibilidad decide antes que "Agregar"/QuantityControl.
    expect(s).toMatch(/!available\s*\?[\s\S]*Agotado/);
  });
});

describe('6B.1R — ProductImage / fallback', () => {
  it('dibuja un placeholder deliberado (emoji) cuando no hay foto', () => {
    const s = comp('ProductImage');
    expect(s).toContain('image.emoji');
    // Solo se pide una imagen si de verdad hay una. `elegida` es la del
    // catálogo, o la propia de una promoción cuando la trae.
    expect(s).toContain('elegida !== null');
    expect(s).toContain('showPhoto');
  });

  it('queda listo para fotos reales locales vía next/image', () => {
    const s = comp('ProductImage');
    expect(s).toContain("import Image from 'next/image'");
    expect(s).toContain('src={elegida as string}');
    // Accesibilidad: el alt describe LO QUE SE VE. Una promoción pasa su
    // propio nombre, porque la foto es la de su producto principal y decir el
    // nombre del producto describiría mal la tarjeta.
    expect(s).toContain('alt={alt ?? item.name}');
    expect(s).toContain('onError'); // si la foto falla, vuelve al placeholder
  });

  it('la foto propia de una promoción gana a la del catálogo', () => {
    const s = comp('ProductImage');
    expect(s).toContain('src ?? image.src');
  });

  it('atenúa la imagen cuando el producto no está disponible', () => {
    expect(comp('ProductImage')).toContain('grayscale');
  });
});

describe('6B.1R — carrito sticky (CartButton)', () => {
  it('muestra cantidad de productos y total', () => {
    const s = comp('CartButton');
    expect(s).toContain('productos');
    expect(s).toContain('{units}');
    expect(s).toContain('formatMoney(total)');
  });

  it('respeta la safe-area inferior y es fijo al pie', () => {
    const s = comp('CartButton');
    expect(s).toContain('env(safe-area-inset-bottom)');
    expect(s).toContain('fixed inset-x-0 bottom-0');
  });

  it('el catálogo deja espacio para que la barra no tape el último producto', () => {
    // MenuStore mantiene padding inferior generoso en la lista.
    expect(comp('MenuStore')).toMatch(/pb-40|pb-44|pb-48/);
  });
});

describe('6B.1R — safe-area en hojas inferiores', () => {
  it('carrito, checkout y éxito respetan la safe-area', () => {
    for (const c of ['CartPanel', 'CheckoutPanel', 'OrderSuccess']) {
      expect(comp(c), c).toContain('env(safe-area-inset-bottom)');
    }
  });
});

/** Quita comentarios de bloque y de línea para escanear solo lo renderizable. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('6B.1R — header sin datos inventados', () => {
  it('no muestra estado abierto/cerrado, horarios, promos ni descuentos', () => {
    const s = stripComments(comp('MenuHeader'));
    for (const fake of [
      'Recibiendo pedidos',
      'Abierto',
      'Cerrado',
      'horario',
      'descuento',
      'promoción',
      'Promo',
      'minutos',
    ]) {
      expect(s, fake).not.toContain(fake);
    }
    // La marca ya no está escrita aquí: llega del perfil del restaurante.
    expect(s).toContain('{restaurantName}');
    expect(s).not.toMatch(/buteco/i);
  });
});

describe('6B.1R — secciones reales en la barra', () => {
  it('CategoryTabs se alimenta del catálogo real (sin etiquetas escritas a mano)', () => {
    const s = comp('CategoryTabs');
    expect(s).toContain('sections.map');
    expect(s).toContain('{section.label}');
    for (const fake of ['Combos', 'Papas', 'Promos', 'Tablas', 'Bebidas']) {
      expect(s, fake).not.toContain(`>${fake}<`);
    }
  });

  it('las secciones salen de las categorías del POS; «Combos» y «Reservas» solo si existen', () => {
    const s = comp('MenuStore');
    expect(s).toContain('...(vendibles.length > 0 ? [{ id: COMBOS_SECTION');
    expect(s).toContain('...sections.map(({ id, label }) => ({ id, label }))');
    expect(s).toContain('...(reservations ? [{ id: RESERVATIONS_SECTION');
  });
});

describe('6B.1R — accesibilidad básica', () => {
  it('los controles de cantidad tienen aria-label en + y −', () => {
    const s = comp('QuantityControl');
    expect(s).toMatch(/Agregar una unidad de|Quitar/);
    expect((s.match(/aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('las hojas inferiores son diálogos accesibles', () => {
    for (const c of ['CartPanel', 'CheckoutPanel', 'OrderSuccess']) {
      const s = comp(c);
      expect(s, c).toContain('role="dialog"');
      expect(s, c).toContain('aria-modal="true"');
    }
  });

  it('la barra de secciones es navegación: enlaces a cada sección, con la actual marcada', () => {
    // Ya no filtra el catálogo (eso era un `tablist`): lleva a cada sección de
    // una sola página, así que es un `<nav>` de enlaces.
    const s = comp('CategoryTabs');
    expect(s).toContain('<nav');
    expect(s).toContain('aria-label="Secciones del menú"');
    expect(s).toContain('href={`#${section.id}`}');
    expect(s).toContain("aria-current={selected ? 'location' : undefined}");
  });

  it('el formulario de reserva rotula cada campo y anuncia sus errores', () => {
    const s = comp('ReservationSection');
    for (const id of ['reserva-dia', 'reserva-hora', 'reserva-nombre', 'reserva-nota']) {
      expect(s, id).toContain(`htmlFor="${id}"`);
      expect(s, id).toContain(`id="${id}"`);
    }
    expect(s).toContain('aria-invalid');
    expect(s).toContain('aria-label="Una persona más"');
  });
});

describe('6B.1R — checkout: lógica intacta (solo presentación)', () => {
  it('CheckoutPanel sigue siendo controlado por el reducer, sin fetch propio', () => {
    const s = comp('CheckoutPanel');
    // Conserva los campos y acciones del flujo existente.
    for (const field of ['customer_name', 'delivery_type', 'notes']) {
      expect(s, field).toContain(field);
    }
    expect(s).toContain('onSubmit');
    expect(s).toContain('onRetry');
    // No introduce peticiones ni acceso a datos desde la vista.
    expect(s).not.toMatch(/\bfetch\(/);
    expect(s).not.toContain('@/lib/supabase');
    expect(s).not.toContain('submitOrder');
  });

  it('MenuStore mantiene el cableado de envío idempotente existente', () => {
    const s = comp('MenuStore');
    expect(s).toContain('submitOrder');
    expect(s).toContain('checkoutReducer');
    expect(s).toContain('inFlight'); // guarda anti doble envío
  });
});

describe('6B.1R — seguridad: el servidor sigue siendo autoridad de precio', () => {
  it('el cliente solo envía code + quantity (nunca precio)', () => {
    // El carrito arma las líneas para el checkout sin precio.
    expect(comp('MenuStore')).toMatch(/code:\s*line\.product_code,\s*[\r\n\s]*quantity:\s*line\.quantity/);
  });

  it('la orquestación server-side recalcula precios reales desde la base', () => {
    const wc = src('../../lib/orders/web-checkout.ts');
    // El payload hacia la RPC es {code, quantity}: sin precio del cliente.
    expect(wc).toMatch(/p_items_json:\s*Array<\{\s*code:\s*string;\s*quantity:\s*number\s*\}>/);
    // La RPC lee los precios reales y calcula subtotal/total en el servidor.
    expect(wc).toContain('create_order_web');
    expect(wc).toMatch(/precios reales/);
  });

  it('ningún componente del menú expone service_role ni secretos', () => {
    for (const c of [
      'MenuHeader',
      'MenuStore',
      'ProductCard',
      'ProductImage',
      'CartButton',
      'CartPanel',
      'CheckoutPanel',
      'OrderSuccess',
      'CategoryTabs',
      'QuantityControl',
      'SearchBar',
      'PromoCard',
      'ReservationSection',
      'Reveal',
    ]) {
      const s = comp(c);
      expect(s, c).not.toContain('SERVICE_ROLE');
      expect(s, c).not.toContain('@/lib/supabase/server');
      expect(s, c).not.toContain('NEXT_PUBLIC');
    }
  });
});

describe('6B.2A — CartPanel responsive (bottom-sheet móvil / drawer desktop)', () => {
  it('en móvil sigue siendo una hoja inferior', () => {
    const s = comp('CartPanel');
    expect(s).toContain('justify-end'); // anclada abajo
    expect(s).toContain('rounded-t-3xl'); // esquinas superiores redondeadas
    expect(s).toContain('max-h-[85vh]'); // altura de hoja
  });

  it('desde lg: es un drawer lateral derecho de altura completa', () => {
    const s = comp('CartPanel');
    expect(s).toContain('lg:flex-row'); // el contenedor pasa a fila (drawer a la derecha)
    expect(s).toContain('lg:justify-end');
    expect(s).toContain('lg:h-full'); // altura completa
    expect(s).toContain('lg:rounded-l-3xl'); // se redondea solo el lado izquierdo
    expect(s).toContain('lg:max-h-none'); // anula el tope de hoja en desktop
  });

  it('el drawer tiene ancho acotado (~520px) y max-width razonable', () => {
    const s = comp('CartPanel');
    expect(s).toContain('lg:w-[520px]');
    expect(s).toContain('lg:max-w-[92vw]');
  });

  it('el contenido del carrito tiene scroll interno', () => {
    expect(comp('CartPanel')).toMatch(/flex-1[^"]*overflow-y-auto/);
  });
});

describe('6B.2A — catálogo responsive (grid)', () => {
  it('móvil = 1 columna, tablet = 2, desktop amplio = 3, con la última fila centrada', () => {
    const s = comp('MenuStore');
    expect(s).toContain('*:w-full');
    expect(s).toContain('sm:*:w-[calc(50%-1rem)]');
    expect(s).toContain('xl:*:w-[calc(33.333%-1.35rem)]');
    // Una sección con un solo plato queda en el medio, no arrinconada.
    expect(s).toMatch(/CARD_GRID =\s*'flex flex-wrap justify-center/);
  });

  it('mantiene un ancho máximo razonable centrado', () => {
    expect(comp('MenuStore')).toContain('max-w-5xl');
  });

  it('ProductCard no cambia su lógica (sin fetch ni acceso a datos)', () => {
    const s = comp('ProductCard');
    expect(s).toContain('formatMoney(item.price)');
    expect(s).toContain('item.is_active');
    expect(s).not.toMatch(/\bfetch\(/);
    expect(s).not.toContain('@/lib/supabase');
  });
});

describe('6B.2A — sticky y sesión intactos', () => {
  it('la barra de búsqueda + categorías sigue sticky con fondo propio', () => {
    const s = comp('MenuStore');
    // Un vidrio oscuro del color de la carta. Sigue siendo sticky y con fondo
    // propio, que es lo que este test protege.
    expect(s).toMatch(/sticky top-0[^"]*bg-menu-night\/90/);
    // El buscador se retiró el 17-09-2026 (el catálogo son 15 productos en
    // tres categorías: se recorre antes de terminar de escribir). Lo que la
    // barra conserva —y este test protege— son las categorías.
    expect(s).not.toContain('<SearchBar');
    expect(s).toContain('<CategoryTabs');
  });

  it('el CartButton sigue respetando la safe-area inferior', () => {
    expect(comp('CartButton')).toContain('env(safe-area-inset-bottom)');
  });

  it('sin sesión, el checkout continúa bloqueado con el aviso de WhatsApp', () => {
    const s = comp('MenuStore');
    expect(s).toContain('Abre el menú desde WhatsApp');
    expect(s).toContain('canCheckout');
    expect(s).toContain('hasSession');
  });
});

/**
 * EL PRODUCTO AGOTADO SE VE, PERO NO SE COBRA (07-09-2026).
 *
 * La vitrina pasó a enseñarlo en gris en vez de esconderlo, y con eso `items`
 * trae por primera vez productos que NO están a la venta. Es un cambio barato en
 * lo visual y caro en lo demás: la misma lista alimenta la parrilla y el
 * carrito, y `calculateOrder` hace una línea de todo lo que se le pase con
 * cantidad. Pasarle la lista entera resucitaría el agotado que el cliente tenía
 * guardado en el navegador y se lo cobraría.
 *
 * Estos tests fijan esa separación. Son de fuente, como el resto del archivo:
 * no prueban el render, prueban que el cableado no se deshaga.
 */
describe('07-09 — agotados: se ven en la vitrina, no entran al carrito', () => {
  it('la página pide TODOS los productos, no solo los activos', () => {
    const s = src('../../app/menu/page.tsx');
    expect(s).toContain('listAll()');
    expect(s).not.toContain('listActive()');
  });

  it('MenuStore filtra por is_active ANTES de darle la lista al carrito', () => {
    const s = comp('MenuStore');
    // Desde el 14-09 la lista de partida es `visibles`: el catálogo menos lo que
    // esa noche va solo en combo. El filtro por `is_active` sigue siendo este.
    expect(s).toMatch(/visibles\.filter\(\(item\) => item\.is_active\)/);
    // El carrito recibe la lista filtrada...
    expect(s).toContain('useCart(aLaVenta,');
    // ...y NUNCA la lista entera: es la línea que volvería a cobrar lo agotado.
    expect(s).not.toContain('useCart(items');
  });

  it('la parrilla y el carrito SÍ ven la lista entera: hay que pintarlo y nombrarlo', () => {
    const s = comp('MenuStore');
    // Sin esto el agotado no se pintaría en gris: volvería a desaparecer.
    expect(s).toContain('groupByCategory(visibles)');
    // Y `visibles` solo quita lo que va en combo (14-09), NUNCA lo agotado: si
    // filtrara por `is_active`, el gris volvería a desaparecer por la puerta de atrás.
    const visibles = s.slice(s.indexOf('const visibles = useMemo'), s.indexOf('const aLaVenta'));
    expect(visibles).toContain('ocultos.has(item.code)');
    expect(visibles).not.toContain('is_active');
    // Y el panel necesita `items` completo para poder decir QUÉ se agotó.
    expect(s).toContain('items={items}');
  });

  it('el carrito avisa de lo que se agotó en vez de descontarlo en silencio', () => {
    const s = comp('CartPanel');
    expect(s).toContain('summary.unavailableCodes');
    expect(s).toMatch(/agot[óa]/);
    // Nombres, no códigos: un "se agotó producto_x" es peor que callarse.
    expect(s).toContain('itemsByCode.get(code)?.name');
  });
});

/**
 * LAS SECCIONES Y LA BARRA (2026-10-13).
 *
 * La carta es una sola página. La barra fija lleva a cada sección y marca la
 * que se está viendo; cada sección tiene que detenerse justo DEBAJO de la
 * barra, no tapada por ella. Como casi todo aquí es CSS, se rompe en silencio:
 * no hay error, el título simplemente queda escondido. Estos tests fijan lo que
 * lo sostiene.
 */
describe('secciones de la carta y barra fija', () => {
  it('cada sección se detiene debajo de la barra, no tapada por ella', () => {
    const s = comp('MenuStore');
    expect((s.match(/scroll-mt-\[var\(--menu-bar-h\)\]/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('la barra queda por encima del contenido', () => {
    expect(comp('MenuStore')).toMatch(/sticky top-0 z-20/);
  });

  it('`--menu-bar-h` se mide del DOM, no es un número mágico escrito a mano', () => {
    const s = comp('MenuStore');
    expect(s).toContain("setProperty('--menu-bar-h'");
    expect(s).toContain('barra.offsetHeight');
    // Y se mantiene: el alto cambia al rotar el teléfono.
    expect(s).toContain('ResizeObserver');
  });

  it('la sección actual la decide el navegador, sin escuchar el scroll', () => {
    const s = stripComments(comp('MenuStore'));
    expect(s).toContain('IntersectionObserver');
    expect(s).not.toMatch(/addEventListener\(\s*'scroll'/);
  });

  it('mover la pestaña marcada no corta el desplazamiento de la página', () => {
    // `scrollIntoView` sobre la pestaña cancela, en Chrome, el desplazamiento
    // suave que el propio toque acaba de iniciar.
    const s = stripComments(comp('CategoryTabs'));
    expect(s).toContain('nav.scrollTo(');
    expect(s).not.toContain('scrollIntoView');
  });

  it('la tarjeta encierra su apilado: la foto no puede montarse sobre la barra', () => {
    const s = comp('ProductCard');
    expect(s).toMatch(/<article className={`relative z-0 /);
  });

  it('ningún ancestro de la barra recorta con overflow: rompería el anclaje', () => {
    // `position: sticky` deja de funcionar si CUALQUIER ancestro tiene overflow
    // distinto de `visible`. El fondo de `page.tsx` es el candidato natural a
    // llevarse un `overflow-hidden` «para recortar»: este test existe para que
    // ese día se entere alguien.
    expect(src('../../app/menu/page.tsx')).not.toContain('overflow-hidden');
  });
});

/**
 * UN PLATO CON OPCIONES ES UNA TARJETA, NO SEIS (2026-10-13).
 */
describe('platos con opciones y combos', () => {
  it('MenuStore junta las opciones de un mismo plato antes de pintar', () => {
    const s = comp('MenuStore');
    expect(s).toContain('entries: groupVariants(group.items)');
    expect(s).toContain("title={entry.kind === 'family' ? entry.name : entry.item.name}");
  });

  it('el carrito sigue siendo por producto: cada opción es su propia línea', () => {
    const s = comp('MenuStore');
    expect(s).toContain('quantityOf={cart.quantity}');
    expect(s).toContain('onAdd={cart.add}');
  });

  it('un combo enseña TODO lo que trae, no una frase recortada', () => {
    const s = comp('PromoCard');
    expect(s).toContain('promotion.components.map');
    expect(s).not.toContain('composeSummary');
    expect(s).toContain('Agregar el combo');
  });

  it('la reserva solo se ofrece si el local la encendió y hay adónde mandarla', () => {
    const page = src('../../app/menu/page.tsx');
    expect(page).toContain('profile.reservationsEnabled');
    expect(page).toMatch(/whatsappChatUrl !== null \|\| process\.env\.NODE_ENV !== 'production'/);
    expect(comp('MenuStore')).toMatch(/\{reservations && \(/);
    // El formulario no guarda nada por su cuenta: abre el chat con el mensaje.
    const form = comp('ReservationSection');
    expect(form).not.toMatch(/\bfetch\(/);
    expect(form).toContain('reservationUrl(chatUrl, reservationMessage(fields, profile.locale))');
  });
});

describe('Pedido registrado — el botón lleva al chat, no al menú (19-09-2026)', () => {
  it('no hay salida al menú: volver dejaba el carrito listo para un segundo pedido', () => {
    const s = stripComments(comp('OrderSuccess'));
    expect(s).not.toContain('Volver al menú');
    expect(s).not.toContain('onBackToMenu');
    expect(stripComments(comp('MenuStore'))).not.toContain('handleBackToMenu');
  });

  it('el único botón abre el chat del negocio', () => {
    const s = comp('OrderSuccess');
    expect(s).toContain('href={whatsappChatUrl}');
    expect(s).toContain('Ir a WhatsApp para pagar');
    // En el mismo tab: una pestaña nueva deja la del pedido atrás y confunde.
    expect(s).not.toContain('target="_blank"');
  });

  it('el número del negocio llega armado desde el servidor', () => {
    expect(comp('MenuStore')).toContain('whatsappChatUrl={whatsappChatUrl}');
    const page = src('../../app/menu/page.tsx');
    expect(page).toContain('businessChatUrl(getServerEnv().WHATSAPP_BUSINESS_NUMBER)');
  });
});

describe('carrito por enlace (19-09-2026)', () => {
  it('los dos carritos guardados se leen con la sesión de la página', () => {
    const s = comp('MenuStore');
    expect(s).toContain('useCart(aLaVenta, cartSessionId)');
    expect(s).toContain('usePromoCart(promotions, ahora, cartSessionId)');
    expect(src('../../app/menu/page.tsx')).toContain('cartSessionId = session.id');
  });

  it('cada carrito anota su dueño en su propia clave', () => {
    // Con una clave compartida, agregar un producto con el enlace nuevo
    // resucitaría los combos guardados del enlace anterior.
    expect(src('../../lib/cart/use-cart.ts')).toContain('cartOwnerKey(CART_STORAGE_KEY)');
    expect(src('../../lib/cart/use-promo-cart.ts')).toContain('cartOwnerKey(PROMO_CART_STORAGE_KEY)');
  });

  it('el token del enlace nunca se usa como dueño del carrito', () => {
    // El token es la credencial que confirma pedidos: no entra en localStorage.
    for (const f of ['../../lib/cart/use-cart.ts', '../../lib/cart/use-promo-cart.ts']) {
      expect(src(f), f).not.toMatch(/sessionToken|token/i);
    }
    expect(comp('MenuStore')).not.toMatch(/useCart\([^)]*sessionToken/);
  });
});
