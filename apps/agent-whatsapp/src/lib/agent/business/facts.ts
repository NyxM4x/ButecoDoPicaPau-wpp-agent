/**
 * DATOS DUROS del negocio — módulo PURO.
 *
 * Aquí vive lo ÚNICO del negocio que el agente puede afirmar de memoria, sin
 * consultar una herramienta: horario y ubicación. Todo lo demás —productos,
 * precios, disponibilidad— sigue viniendo de `get_menu_items`.
 *
 * ── De dónde salen ───────────────────────────────────────────────────────────
 *
 * Del perfil del restaurante (`lib/restaurant/profile`), que viene del POS.
 * Hasta el 2026-10-13 eran constantes de Don Zarco escritas en este archivo, y
 * cambiar el horario pedía un despliegue.
 *
 * ── Por qué estos datos sí entran al prompt ─────────────────────────────────
 *
 * El prompt se escribió con una regla dura: CERO datos de negocio adentro. Un
 * dato pegado en el prompt parece verificado sin serlo. El horario y la
 * dirección son la excepción deliberada: cambian muy rara vez y son las dos
 * preguntas más frecuentes de WhatsApp. Dejarlos fuera obligaba a derivar a
 * una persona la mitad de las consultas.
 *
 * Lo que NO va aquí: precios, productos, promociones, tiempos de entrega,
 * tarifas de envío ni nada que ya tenga una fuente de verdad en el POS.
 */
import { hoursInWords, scheduleSentence } from '@/lib/restaurant/hours';
import { restaurantProfile, type RestaurantProfile } from '@/lib/restaurant/profile';

/** Cómo se presenta el negocio. */
export function businessName(profile: RestaurantProfile = restaurantProfile()): string {
  return profile.name;
}

/**
 * Horario de atención, redactado tal como el agente puede repetirlo.
 *
 * Es el horario REGULAR. El agente nunca deduce de aquí si está abierto en este
 * momento: no tiene reloj confiable, no sabe de feriados y no sabe si hoy
 * cerraron antes. Esa restricción viaja en el prompt.
 */
export function businessHours(profile: RestaurantProfile = restaurantProfile()): string {
  return hoursInWords(profile);
}

/**
 * El horario para un mensaje automático: `todos los días de 19:00 a 04:00`.
 *
 * Lo usan los mensajes que no conversan, donde la prosa sobra. Sale del mismo
 * horario semanal que usa el sistema: la copia a mano que había en
 * `kapso/messages.ts` se quedó desactualizada exactamente como avisaba su
 * propio comentario que pasaría.
 */
export function businessSchedule(profile: RestaurantProfile = restaurantProfile()): string {
  return scheduleSentence(profile);
}

/** Enlace de Google Maps del local, o `null` si el local no lo cargó. */
export function businessMapsUrl(profile: RestaurantProfile = restaurantProfile()): string | null {
  return profile.mapsUrl;
}

/**
 * Dirección en palabras (calle, barrio o referencia), o `null`.
 *
 * Con `null`, el agente responde SOLO con el enlace de Maps: es preferible a
 * inventar una calle o a transcribir mal un barrio.
 */
export function businessAddress(profile: RestaurantProfile = restaurantProfile()): string | null {
  return profile.address;
}

/**
 * La línea de ubicación del prompt.
 *
 * ── La dirección y el enlace van JUNTOS, y es una orden ─────────────────
 *
 * Antes decía "el enlace es este y puedes compartirlo tal cual". Eso es un
 * permiso, no una instrucción, y el modelo hacía lo que hace cualquiera con un
 * permiso: unas veces sí y otras no (02-09-2026). Cada una sola falla de una
 * forma distinta: la dirección sin enlace obliga al cliente a buscarla a mano,
 * y el enlace sin dirección obliga a abrir el navegador solo para saber si
 * queda cerca.
 */
function locationFact(profile: RestaurantProfile): string {
  const { address, mapsUrl } = profile;
  if (address && mapsUrl) {
    return `- Dónde están: ${address}. Cuando pregunten por la ubicación, responde SIEMPRE con las dos cosas en el mismo mensaje: esa dirección en palabras y el enlace de Google Maps ${mapsUrl} escrito entero. Nunca una sin la otra.`;
  }
  if (mapsUrl) {
    return `- Dónde están: no tienes la dirección escrita, así que no la inventes ni la describas. Cuando pregunten por la ubicación, pasa el enlace de Google Maps tal cual, escrito entero dentro del mensaje: ${mapsUrl}`;
  }
  if (address) {
    return `- Dónde están: ${address}. Es lo único que sabes de la ubicación: no agregues referencias ni indicaciones para llegar, y no inventes un enlace.`;
  }
  return '- Dónde están: no tienes la dirección ni un enlace, así que no los inventes. Si preguntan por la ubicación, di que no la tienes a mano para confirmársela.';
}

/** La línea del envío, según lo que el local ofrece hoy. */
function deliveryFact(profile: RestaurantProfile): string {
  if (!profile.deliveryEnabled) {
    return '- No hacen envíos a domicilio: los pedidos se retiran en el local.';
  }
  return '- Hacen envíos a domicilio. El costo lo calcula el sistema con la ubicación del cliente, en el momento; tú nunca lo estimas.';
}

/**
 * Bloque de "hechos del negocio" que se inyecta en el system prompt.
 *
 * ── Que hay un solo local es un HECHO, no un dato que falte ──────────────
 *
 * "¿Están también en otra zona?" se contestaba con "no tengo esa información",
 * porque la sección "Cuando no sabes" del prompt recoge todo lo que no esté
 * escrito aquí. Pero no es que se ignore: es que no hay más locales. Se dice
 * explícitamente para que el agente afirme en vez de encogerse de hombros.
 */
export function businessFactsBlock(profile: RestaurantProfile = restaurantProfile()): string {
  return [
    'Lo único que sabes de memoria (y puedes decir sin consultar nada):',
    `- Horario de atención: ${businessHours(profile)}.`,
    locationFact(profile),
    '- Es su ÚNICO local: no hay sucursales ni otro punto de venta. Si preguntan si están en otra zona, en otro barrio o si tienen otra sede, contesta que no, que solo atienden en esa dirección. Eso lo sabes: no es un dato que te falte, así que no respondas que no tienes la información.',
    deliveryFact(profile),
    '- Fuera de lo anterior, no tienes ningún dato del negocio en la cabeza.',
  ].join('\n');
}
