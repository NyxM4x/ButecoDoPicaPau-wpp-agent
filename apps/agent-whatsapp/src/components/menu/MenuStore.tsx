'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MenuItem } from '@/types';
import { useCart } from '@/lib/cart/use-cart';
import { usePromoCart } from '@/lib/cart/use-promo-cart';
import { useServerClock } from '@/lib/menu/use-server-clock';
import { unifiedTotals } from '@/lib/cart/promo-cart';
import { evaluatePromotion, isPurchasable, type Promotion } from '@/lib/promotions/promotion';
import { orderSectionsForMode, promoModeAt } from '@/lib/promotions/promo-mode';
import { groupByCategory, productImage } from '@/lib/menu/catalog';
import { groupVariants } from '@/lib/menu/variants';
import { heroComponent } from '@/lib/promotions/promotion-display';
import { submitOrder } from '@/lib/checkout/client';
import { validateCheckoutForm, type CheckoutFormFields } from '@/lib/checkout/form';
import {
  INITIAL_CHECKOUT_STATE,
  canRetry as canRetryState,
  canSubmit as canSubmitState,
  checkoutReducer,
  isFrozen,
  isSessionBlocked,
} from '@/lib/checkout/state';
import { CartButton } from './CartButton';
import { CartPanel } from './CartPanel';
import { CategoryTabs, type MenuSectionLink } from './CategoryTabs';
import { CheckoutPanel } from './CheckoutPanel';
import { OrderSuccess } from './OrderSuccess';
import { ProductCard } from './ProductCard';
import { PromoCard } from './PromoCard';
import { ReservationSection } from './ReservationSection';

/**
 * La parrilla de una sección: 1 columna en el celular, 2 en tablet y 3 en
 * pantalla ancha. Es `flex` y no `grid` para poder CENTRAR la última fila: una
 * sección con un solo plato —la «Tabla», con sus seis carnes dentro— queda en
 * el medio, no arrinconada a la izquierda junto a dos columnas vacías.
 */
const CARD_GRID =
  'flex flex-wrap justify-center gap-x-8 gap-y-10 *:w-full sm:*:w-[calc(50%-1rem)] xl:*:w-[calc(33.333%-1.35rem)]';

/** Los `id` de las dos secciones que no son una categoría del catálogo. */
const COMBOS_SECTION = 'combos';
const RESERVATIONS_SECTION = 'reservas';

const NO_SESSION_NOTICE = 'Abre el menú desde WhatsApp para confirmar tu pedido.';
/** Pedidos nuevos pausados por saturación (0038, 14-09-2026). */
const ORDERS_PAUSED_NOTICE =
  'Estamos con demasiados pedidos y pausamos los nuevos por un rato. Vuelve a intentarlo en unos minutos.';
/** El enlace ya tiene un pedido: 201, 200 idempotente o 409. */
const SESSION_USED_NOTICE =
  'Este enlace ya fue utilizado. Vuelve a WhatsApp para solicitar un nuevo enlace y realizar otro pedido.';
/** El enlace no es válido o venció: 401. */
const SESSION_INVALID_NOTICE =
  'Este enlace ya no es válido. Vuelve a WhatsApp y solicita nuevamente el menú.';
/**
 * El enlace venía a CAMBIAR un pedido que ya está pagado (07-09-2026).
 *
 * Empieza por la buena noticia y a propósito: quien lee esto acaba de armar un
 * carrito que no va a poder mandar, y lo primero que necesita saber es que su
 * pedido no se perdió. Después, qué hacer con lo que quería añadir.
 *
 * No lo manda a hablar con nadie: al escribir por WhatsApp recibe el botón del
 * menú, que es exactamente lo que hace falta para el pedido nuevo.
 */
const ORDER_PAID_NOTICE =
  'Tu pedido anterior ya está pagado y en preparación, así que este enlace ya no puede ' +
  'cambiarlo. Escribinos por WhatsApp y armamos un pedido nuevo con lo que falte.';

/**
 * Tienda: catálogo, carrito y checkout.
 *
 * Los productos llegan ya leídos de Supabase por el Server Component. El
 * carrito vive en `localStorage`; el checkout, en un reducer puro
 * (`@/lib/checkout/state`) que concentra las guardas contra el doble envío y el
 * reintento tras un resultado ambiguo.
 *
 * `sessionToken` llega como prop y NO se guarda en el estado ni en
 * `localStorage`: solo se pasa a `submitOrder` en el momento del envío.
 */
export function MenuStore({
  items,
  promotions,
  serverNow,
  sessionToken,
  replacingOrder = null,
  ordersPaused = false,
  whatsappChatUrl = null,
  cartSessionId = null,
  rules = null,
  brand,
  reservations = null,
}: {
  /** El nombre y el logo del local, para la barra fija. */
  brand: { name: string; logoUrl: string | null };
  /**
   * La reserva de mesas, o `null` si el local no la ofrece. `chatUrl` es el
   * chat de WhatsApp adonde va la reserva.
   */
  reservations?: { chatUrl: string | null } | null;
  /**
   * Qué se ofrece en el checkout cuando el catálogo viene del backend central.
   *
   * Con esto presente NO aplica la "noche de promoción" (sin
   * efectivo, sin recojo, bebidas arriba): esa regla era de un negocio, y con
   * el backend central cada local decide lo suyo en Configuración del POS.
   * Ausente = todo como siempre.
   */
  rules?: {
    cashAllowed: boolean;
    pickupAllowed: boolean;
    /** Ausentes = sí: es lo que el menú ofrecía antes de que existieran. */
    deliveryAllowed?: boolean;
    qrAllowed?: boolean;
  } | null;
  /**
   * La sesión del menú con que se abrió la página (19-09-2026), o `null` sin
   * enlace. El carrito guardado en el navegador solo se recupera con el mismo
   * enlace con que se armó: un enlace nuevo empieza vacío, y así no reaparece
   * lo que quedó a medias hace días.
   */
  cartSessionId?: string | null;
  /**
   * El chat de WhatsApp del negocio (`wa.me`), armado en el servidor. Es el
   * botón de la pantalla de "Pedido registrado"; `null` = número sin configurar.
   */
  whatsappChatUrl?: string | null;
  /**
   * ¿Pedidos nuevos pausados por saturación? (0038) Leído en el servidor. Se
   * puede mirar el menú y armar el carrito, pero no confirmar.
   */
  ordersPaused?: boolean;
  items: MenuItem[];
  /** Combos publicables, ya leídos en el servidor. */
  promotions: Promotion[];
  /**
   * Reloj del SERVIDOR en el momento de renderizar. Con él se decide si un
   * combo está vigente: el celular del cliente puede tener la hora mal, y una
   * promoción que vence a las 23:31 no puede depender de eso.
   *
   * `useServerClock` lo hace avanzar sumándole el tiempo transcurrido, para que
   * una pestaña abierta durante horas no se quede en el pasado.
   */
  serverNow: number;
  sessionToken: string | null;
  /**
   * El pedido que este enlace viene a CAMBIAR (0035), ya leído en el servidor.
   *
   * Cuando llega, el carrito se siembra con lo que el cliente había pedido para
   * que solo tenga que tocar lo que quiere cambiar. Ausente = enlace normal, y
   * entonces esta pantalla se comporta exactamente como siempre.
   */
  replacingOrder?: {
    orderNumber: string;
    items: Record<string, number>;
    promotions: Record<string, number>;
  } | null;
}) {
  /** La sección que se está viendo: la marca la barra. `null` = arriba del todo. */
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /**
   * ¿La barra ya quedó pegada arriba? Mientras la portada está a la vista, el
   * nombre del local ya se lee ahí a lo grande, y repetirlo en la barra dos
   * dedos más abajo sobra. Aparece cuando la portada se va.
   */
  const [barStuck, setBarStuck] = useState(false);
  const barSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = barSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setBarStuck(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  const [cartOpen, setCartOpen] = useState(false);

  /**
   * El alto REAL de la barra fija, publicado como `--menu-bar-h`
   * (EXPERIMENTAL, rediseno-menu-fastfood, 17-09-2026).
   *
   * Los encabezados de categoría se anclan justo debajo de la barra, así que
   * necesitan su alto. Escribirlo a mano como número mágico envejece mal: basta
   * que alguien cambie el padding del buscador para que los títulos queden
   * tapados a medias, y es de esas cosas que nadie vuelve a mirar.
   *
   * Medirlo en vivo lo mantiene correcto solo. `globals.css` trae un valor de
   * arranque para el primer render (aquí todavía no hay DOM que medir).
   */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const barra = barRef.current;
    if (!barra) return;

    const publicar = () => {
      document.documentElement.style.setProperty('--menu-bar-h', `${barra.offsetHeight}px`);
    };
    publicar();

    // El alto cambia al rotar el teléfono o si el texto crece: no basta medirlo
    // una vez al montar.
    const observer = new ResizeObserver(publicar);
    observer.observe(barra);
    return () => observer.disconnect();
  }, []);

  // El instante del servidor, avanzando. Sin esto, una pestaña abierta desde
  // hace horas seguiría mostrando una promoción que ya venció.
  const ahora = useServerClock(serverNow);

  /**
   * ¿Noche de promoción? (14-09-2026). Ver `promotions/promo-mode`.
   *
   * Con el reloj del servidor, igual que las tarjetas de los combos: a las 00:00
   * la pestaña abierta vuelve sola al menú de siempre —orden, sueltos y
   * efectivo— sin recargar.
   */
  const cashRule = rules?.cashAllowed;
  const pickupRule = rules?.pickupAllowed;
  const deliveryAllowed = rules?.deliveryAllowed ?? true;
  const qrAllowed = rules?.qrAllowed ?? true;
  const modo = useMemo(
    () =>
      cashRule === undefined || pickupRule === undefined
        ? promoModeAt(promotions, ahora)
        : {
            active: false,
            cashAllowed: cashRule,
            pickupAllowed: pickupRule,
            comboOnlyCodes: new Set<string>(),
          },
    [promotions, ahora, cashRule, pickupRule],
  );
  // `modo` es un objeto nuevo en cada tick del reloj. La lista de productos solo
  // tiene que rehacerse cuando cambia QUÉ se esconde, no cada 30 segundos.
  const soloEnCombo = [...modo.comboOnlyCodes].sort().join(',');

  /**
   * Lo que se puede VER: el catálogo menos lo que esta noche va solo en combo.
   *
   * El suelto se esconde en vez de pintarse "Agotado": no está agotado, está
   * dentro de la tarjeta de arriba, y un Chicharrón en gris debajo del combo de
   * Chicharrones haría pensar que el combo tampoco se puede pedir.
   */
  const visibles = useMemo(() => {
    const ocultos = new Set(soloEnCombo === '' ? [] : soloEnCombo.split(','));
    return ocultos.size === 0 ? items : items.filter((item) => !ocultos.has(item.code));
  }, [items, soloEnCombo]);

  /**
   * Lo que se puede COBRAR, que no es lo que se puede VER (07-09-2026).
   *
   * Desde que la vitrina enseña los agotados en gris, `items` trae también lo
   * que no está a la venta. El carrito no puede verlo: `calculateOrder` recorre
   * la lista que se le pasa y hace una línea de todo lo que tenga cantidad, así
   * que pasarle la lista entera resucitaría el producto agotado que quedó
   * guardado en el navegador del cliente — y se lo cobraría.
   *
   * El servidor lo rechazaría al crear el pedido (`orders/service` usa
   * `listActive`), pero eso es un error DESPUÉS de que el cliente lo dio por
   * pedido. La lista de aquí es la que evita llegar hasta ahí.
   *
   * Sale de `visibles` y no de `items`: el Chicharrón que quedó en el carrito
   * antes de la promoción tampoco puede cobrarse suelto esta noche.
   */
  const aLaVenta = useMemo(() => visibles.filter((item) => item.is_active), [visibles]);

  const cart = useCart(aLaVenta, cartSessionId);
  const promos = usePromoCart(promotions, ahora, cartSessionId);

  /**
   * El pedido que se está cambiando, de vuelta en el carrito (0035).
   *
   * ── Solo una vez, y solo sobre un carrito vacío ───────────────────────────
   *
   * Una vez, porque si no cada render devolvería el carrito a su estado
   * original y el cliente no podría quitar nada. Y solo si está vacío, porque
   * un carrito con cosas dentro es del cliente: ya lo retocó con este mismo
   * enlace —recargó, volvió a tocar el botón— y pisarle eso sería borrarle
   * trabajo. Lo que quedó de un enlace anterior no cuenta: el carrito es por
   * enlace (19-09-2026), así que aquí llega vacío.
   *
   * Se espera a `hydrated`: hasta entonces `cart.cart` está vacío por
   * construcción —el snapshot del servidor es siempre nulo— y sembrar ahí
   * pisaría el carrito guardado sin haberlo leído.
   */
  const sembrado = useRef(false);
  useEffect(() => {
    if (sembrado.current || !replacingOrder || !cart.hydrated) return;
    sembrado.current = true;

    const vacio =
      Object.keys(cart.cart).length === 0 && Object.keys(promos.state).length === 0;
    if (!vacio) return;

    cart.seed(replacingOrder.items);
    promos.seed(replacingOrder.promotions);
  }, [replacingOrder, cart, promos]);
  // TODO lo que se pinta —el botón, la cabecera, el resumen— sale de aquí. Dos
  // estados separados que se suman por su cuenta en cada pantalla producen el
  // fallo clásico: "0 productos, Bs 0,00" con un combo dentro.
  const unified = unifiedTotals(cart.summary, promos.summary);
  const [checkout, dispatch] = useReducer(checkoutReducer, INITIAL_CHECKOUT_STATE);

  /**
   * Segunda barrera contra el doble envío, además del reducer: cubre el caso de
   * dos toques en el mismo tick, antes de que React aplique el nuevo estado.
   */
  const inFlight = useRef(false);

  const modoActivo = modo.active;
  /**
   * Las secciones de la carta: una por categoría, y dentro de cada una los
   * platos con sus opciones ya juntas (las seis «Tabla - …» son un solo plato).
   */
  const sections = useMemo(
    () =>
      // En noche de promoción las bebidas suben debajo de los combos: son lo
      // que acompaña al combo. A las 00:00 vuelve el orden de siempre.
      orderSectionsForMode(groupByCategory(visibles), { active: modoActivo }).map((group, index) => ({
        id: `seccion-${index + 1}`,
        label: group.label,
        entries: groupVariants(group.items),
      })),
    [visibles, modoActivo],
  );

  /**
   * El formulario tal como se pinta y se envía.
   *
   * Sin efectivo, el método es QR y punto; sin recojo, la entrega es envío y
   * punto. Se DERIVA aquí en vez de escribirlo en el reducer con un efecto. Así
   * no hay un render con "Efectivo" o "Recojo" marcado en un formulario que ya
   * no lo ofrece, y a las 00:00 lo que el cliente había elegido sigue intacto.
   */
  const fields = useMemo(() => {
    let f = checkout.fields;
    if (!modo.cashAllowed && f.payment_method !== 'qr') f = { ...f, payment_method: 'qr' as const };
    if (!modo.pickupAllowed && f.delivery_type !== 'delivery') {
      f = { ...f, delivery_type: 'delivery' as const };
    }
    // Lo mismo al revés, cuando lo que el local no ofrece es el envío o el QR.
    // Con las dos opciones apagadas (un perfil mal cargado) gana lo de arriba:
    // el POS rechaza el pedido y lo dice.
    if (!deliveryAllowed && modo.pickupAllowed && f.delivery_type !== 'pickup') {
      f = { ...f, delivery_type: 'pickup' as const };
    }
    if (!qrAllowed && modo.cashAllowed && f.payment_method !== 'cash') {
      f = { ...f, payment_method: 'cash' as const };
    }
    return f;
  }, [checkout.fields, modo.cashAllowed, modo.pickupAllowed, deliveryAllowed, qrAllowed]);

  const hasSession = sessionToken !== null;
  // El checkout solo está disponible con un enlace que aún no se haya bloqueado,
  // y con los pedidos nuevos abiertos (0038).
  const canCheckout = hasSession && !isSessionBlocked(checkout) && !ordersPaused;
  const frozen = isFrozen(checkout);
  const submitting = checkout.step === 'submitting';

  const cartNotice = ordersPaused
    ? ORDERS_PAUSED_NOTICE
    : checkout.sessionBlockReason === 'used'
      ? SESSION_USED_NOTICE
      : checkout.sessionBlockReason === 'invalid'
        ? SESSION_INVALID_NOTICE
        : checkout.sessionBlockReason === 'paid'
          ? ORDER_PAID_NOTICE
          : hasSession
            ? null
            : NO_SESSION_NOTICE;

  /** Combos vendibles AHORA, en el formato que espera el checkout. */
  const cartPromotions = useMemo(
    () =>
      promos.summary.lines.map((line) => ({
        promotion_id: line.promotionId,
        quantity: line.quantity,
        // La revisión que el cliente vio. Si cambió, el servidor lo rechaza en
        // vez de cobrarle una versión que no estaba mirando.
        revision: line.revision,
      })),
    [promos.summary.lines],
  );

  /** Líneas del carrito en el formato que espera el checkout. */
  const cartItems = useMemo(
    () =>
      cart.summary.lines.map((line) => ({
        code: line.product_code,
        quantity: line.quantity,
      })),
    [cart.summary.lines],
  );

  /** Envía el pedido y traduce el resultado a acciones del reducer. */
  const send = useCallback(
    async (token: string, snapshot: Parameters<typeof submitOrder>[1]) => {
      inFlight.current = true;
      try {
        const result = await submitOrder(token, snapshot);

        if (result.ok) {
          dispatch({ type: 'SUCCESS', order: result.order, created: result.created });
          // Único punto de vaciado: solo tras 201 o 200 confirmados. Los dos
          // carritos, o el cliente vería su combo intacto tras pagarlo.
          cart.clear();
          promos.clear();
          setCartOpen(false);
          return;
        }

        dispatch({ type: 'FAILURE', failure: result.failure });
      } finally {
        inFlight.current = false;
      }
    },
    [cart, promos],
  );

  const handleSubmit = useCallback(() => {
    if (inFlight.current || submitting) return;
    if (!sessionToken) return;
    // Guarda explícita: el envío normal solo procede desde el formulario. No se
    // delega en que el reducer ignore SUBMIT, porque entonces `send` correría
    // igual y dispararía una petición sin transición de estado.
    if (!canSubmitState(checkout)) return;

    // `fields` y no `checkout.fields`: lo que se envía es lo que se ve.
    const validation = validateCheckoutForm(fields, cartItems, cartPromotions);
    if (!validation.ok) {
      dispatch({ type: 'VALIDATION_FAILED', errors: validation.errors });
      return;
    }

    dispatch({ type: 'SUBMIT', snapshot: validation.value });
    void send(sessionToken, validation.value);
  }, [cartItems, cartPromotions, checkout, fields, sessionToken, submitting, send]);

  const handleRetry = useCallback(() => {
    if (inFlight.current || submitting) return;
    if (!sessionToken || !checkout.snapshot) return;
    if (!canRetryState(checkout)) return;

    // Se reenvía la fotografía guardada, nunca el carrito actual: si el pedido
    // ya se creó, el fingerprint coincide y el backend responde 200.
    dispatch({ type: 'RETRY' });
    void send(sessionToken, checkout.snapshot);
  }, [checkout, sessionToken, submitting, send]);

  const handleFieldChange = useCallback((field: keyof CheckoutFormFields, value: string) => {
    dispatch({ type: 'SET_FIELD', field, value });
  }, []);

  const handleOpenCheckout = useCallback(() => {
    if (!canCheckout) return;
    dispatch({ type: 'OPEN_FORM' });
  }, [canCheckout]);

  const handleBackToCart = useCallback(() => {
    dispatch({ type: 'CLOSE' });
    setCartOpen(true);
  }, []);

  const handleCloseCheckout = useCallback(() => {
    dispatch({ type: 'CLOSE' });
  }, []);

  /**
   * Las promociones que se pueden comprar AHORA.
   *
   * El filtro se hace aquí y no en el servidor porque el estado depende del
   * reloj: una promoción que vence a mitad de la sesión deja de mostrarse sin
   * recargar. Y como el instante es el del servidor, no lo decide el celular.
   */
  const vendibles = useMemo(
    () =>
      promotions
        .map((promotion) => ({ promotion, pricing: evaluatePromotion(promotion, ahora) }))
        .filter(({ pricing }) => isPurchasable(pricing)),
    [promotions, ahora],
  );

  /** La foto de cada combo: la suya, o la de su producto principal. */
  const promoImages = useMemo(() => {
    const byCode = new Map(items.map((item) => [item.code, item]));
    return new Map(
      promotions.map((promotion) => {
        const hero = heroComponent(promotion.components);
        const item = hero ? byCode.get(hero.code) : undefined;
        return [promotion.id, promotion.imageUrl ?? (item ? productImage(item).src : null)] as const;
      }),
    );
  }, [items, promotions]);

  /** Las pestañas de la barra, en el orden en que aparecen las secciones. */
  const sectionLinks = useMemo<MenuSectionLink[]>(
    () => [
      ...(vendibles.length > 0 ? [{ id: COMBOS_SECTION, label: 'Combos' }] : []),
      ...sections.map(({ id, label }) => ({ id, label })),
      ...(reservations ? [{ id: RESERVATIONS_SECTION, label: 'Reservas' }] : []),
    ],
    [vendibles.length, sections, reservations],
  );
  const sectionIds = sectionLinks.map((link) => link.id).join(',');

  /*
   * Qué sección se está viendo. Una franja fina a un tercio de la pantalla hace
   * de «línea de lectura»: la sección que la cruza es la actual. Lo resuelve el
   * navegador (IntersectionObserver); no se escucha el scroll.
   */
  useEffect(() => {
    if (sectionIds === '' || typeof IntersectionObserver === 'undefined') return;
    const ids = sectionIds.split(',');
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossing.add(entry.target.id);
          else crossing.delete(entry.target.id);
        }
        setActiveSection(ids.find((id) => crossing.has(id)) ?? null);
      },
      { rootMargin: '-32% 0px -66% 0px' },
    );
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [sectionIds]);

  const goToSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const hasResults = sections.length > 0;
  const checkoutOpen = checkout.step === 'form' || checkout.step === 'submitting' || checkout.step === 'failed';
  const showCartButton =
    cart.hydrated && unified.units > 0 && !cartOpen && !checkoutOpen && checkout.step !== 'success';

  return (
    <>
      {/* Deja de verse justo cuando la barra se pega arriba: así se sabe. */}
      <div ref={barSentinelRef} className="h-px" aria-hidden />

      {/* La barra fija: la marca y las secciones. El alto se publica en
          `--menu-bar-h` para que cada sección se detenga justo debajo. */}
      <div
        ref={barRef}
        className="sticky top-0 z-20 border-b border-white/10 bg-menu-night/90 shadow-lg shadow-black/40 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-5xl items-center pl-4 pt-[env(safe-area-inset-top)]">
          {brand.logoUrl ? (
            <a href="#" aria-label={`${brand.name}: volver arriba`} className="mr-3 flex shrink-0 items-center">
              {/* El logo puede estar en cualquier dominio (lo configura cada
                  local), y `next/image` exige declararlos uno por uno. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto max-w-24 object-contain" />
            </a>
          ) : (
            // Sin logo, el nombre: solo cuando la portada ya no lo está diciendo.
            <a
              href="#"
              aria-label={`${brand.name}: volver arriba`}
              tabIndex={barStuck ? undefined : -1}
              aria-hidden={barStuck ? undefined : true}
              className={`flex shrink-0 items-center overflow-hidden transition-all duration-300 ${
                barStuck ? 'mr-3 max-w-28 opacity-100' : 'mr-0 max-w-0 opacity-0'
              }`}
            >
              <span className="font-menu-dish w-28 shrink-0 text-xl leading-[0.9] font-extrabold text-menu-cream">
                {brand.name}
              </span>
            </a>
          )}
          <CategoryTabs sections={sectionLinks} active={activeSection} onSelect={goToSection} />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-40">
        {/* Antes del catálogo y solo si hay algo que ofrecer: una sección vacía
            titulada «Combos» promete algo que no existe. */}
        {vendibles.length > 0 && (
          <section id={COMBOS_SECTION} aria-label="Combos" className="scroll-mt-[var(--menu-bar-h)]">
            <SectionTitle label="Combos" />
            <div className={CARD_GRID}>
              {vendibles.map(({ promotion, pricing }) => (
                <PromoCard
                  key={promotion.id}
                  promotion={promotion}
                  pricing={pricing}
                  quantity={promos.quantity(promotion.id)}
                  now={ahora}
                  imageSrc={promoImages.get(promotion.id) ?? null}
                  onAdd={() => promos.add(promotion.id)}
                  onRemove={() => promos.remove(promotion.id)}
                />
              ))}
            </div>
          </section>
        )}

        {hasResults ? (
          sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-label={section.label}
              className="scroll-mt-[var(--menu-bar-h)]"
            >
              <SectionTitle label={section.label} />
              <div className={CARD_GRID}>
                {section.entries.map((entry) => (
                  <ProductCard
                    key={entry.key}
                    title={entry.kind === 'family' ? entry.name : entry.item.name}
                    options={entry.kind === 'family' ? entry.options : [{ label: entry.item.name, item: entry.item }]}
                    quantityOf={cart.quantity}
                    onAdd={cart.add}
                    onRemove={cart.remove}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="mt-10 rounded-3xl bg-menu-surface/85 px-4 py-10 text-center text-sm text-white/80 ring-1 ring-white/15 backdrop-blur-sm">
            Por ahora no hay nada en la carta.
          </p>
        )}

        {reservations && (
          <section
            id={RESERVATIONS_SECTION}
            aria-label="Reservas"
            className="scroll-mt-[var(--menu-bar-h)]"
          >
            <SectionTitle label="Reserva tu mesa" />
            <ReservationSection chatUrl={reservations.chatUrl} />
          </section>
        )}
      </div>

      {showCartButton ? (
        <CartButton
          units={unified.units}
          total={unified.total}
          onOpen={() => setCartOpen(true)}
        />
      ) : null}

      <CartPanel
        open={cartOpen && unified.units > 0 && !checkoutOpen && checkout.step !== 'success'}
        summary={cart.summary}
        promoSummary={promos.summary}
        items={items}
        now={ahora}
        onClose={() => setCartOpen(false)}
        onAdd={cart.add}
        onRemove={cart.remove}
        onAddPromo={promos.add}
        onRemovePromo={promos.remove}
        onContinue={handleOpenCheckout}
        canCheckout={canCheckout}
        checkoutNotice={cartNotice}
      />

      <CheckoutPanel
        open={checkoutOpen}
        fields={fields}
        cashAllowed={modo.cashAllowed}
        deliveryAllowed={deliveryAllowed}
        qrAllowed={qrAllowed}
        pickupAllowed={modo.pickupAllowed}
        errors={checkout.errors}
        summary={cart.summary}
        promoSummary={promos.summary}
        submitting={submitting}
        frozen={frozen}
        failure={checkout.failure}
        canRetry={canRetryState(checkout)}
        canSubmit={canSubmitState(checkout)}
        onChange={handleFieldChange}
        onSubmit={handleSubmit}
        onRetry={handleRetry}
        onBackToCart={handleBackToCart}
        onClose={handleCloseCheckout}
      />

      {checkout.step === 'success' && checkout.order ? (
        <OrderSuccess order={checkout.order} whatsappChatUrl={whatsappChatUrl} />
      ) : null}
    </>
  );
}

/**
 * El nombre de una sección de la carta, a lo grande.
 *
 * No se queda fijo al desplazarse: de decir por dónde va uno se ocupa la barra,
 * que marca la sección actual. Un título anclado encima de cada plato le
 * quitaría a la foto el sitio que aquí es suyo.
 *
 * El tamaño sigue al ancho de la pantalla (`clamp`): «Especialidades» tiene que
 * caber en una línea en el celular más angosto sin achicar «Jugos» en el resto.
 */
function SectionTitle({ label }: { label: string }) {
  return (
    <header className="pt-14 pb-7 text-center">
      <h2 className="font-menu-title text-[clamp(1.75rem,9.2vw,3.5rem)] leading-none break-words text-menu-cream uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.65)]">
        {label}
      </h2>
      <span className="mx-auto mt-4 block h-1 w-16 rounded-full bg-menu-accent" aria-hidden />
    </header>
  );
}
