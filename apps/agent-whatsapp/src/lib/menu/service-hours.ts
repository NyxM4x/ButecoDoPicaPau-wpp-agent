import { DAY_NAMES, serviceMomentAt } from '@/lib/restaurant/hours';
import { restaurantProfile, type RestaurantProfile } from '@/lib/restaurant/profile';

/**
 * El aviso de horario del menú — módulo PURO.
 *
 * El menú está abierto a cualquier hora —el enlace llega por WhatsApp y la
 * gente lo abre cuando quiere—, así que fuera del servicio hay que decirle al
 * cliente en qué momento entró. Con un local que atiende de 19:00 a 04:00:
 *
 *   · 18:30–19:00  el local está por abrir. Se puede ir armando el pedido.
 *   · 19:00–03:50  se está sirviendo: NO se muestra nada.
 *   · 03:50–04:15  el cierre está encima. Se acepta la solicitud, pero se
 *                  advierte de que hay que consultar si todavía da tiempo.
 *   · 04:15–18:30  cerrado. Es la franja larga, y la que más se ve.
 *
 * Las franjas se tocan sin pisarse y sin dejar un minuto mudo: fuera del
 * servicio SIEMPRE hay un cartel. Un hueco con el local cerrado deja el menú
 * exactamente igual que cuando está abierto, que es el engaño que todo esto
 * vino a corregir.
 *
 * Las horas salen del horario semanal del perfil (`lib/restaurant/hours`):
 * hasta el 2026-10-13 eran las de la demo, escritas aquí.
 *
 * ── Por qué franjas y no "¿está abierto?" ───────────────────────────────────
 *
 * Un indicador de abierto/cerrado sería un semáforo: mismo peso a las tres de
 * la tarde que cinco minutos antes de cerrar, cuando lo que el cliente necesita
 * saber en cada momento es distinto. Cada franja dice qué le va a pasar a SU
 * pedido si lo manda ahora, que es la única pregunta que se está haciendo.
 */

/** Aviso a mostrar, ya resuelto. `null` = no mostrar nada. */
export interface ServiceNotice {
  kind: 'opening' | 'after_hours' | 'closed';
  title: string;
  body: string;
}

/**
 * Qué aviso toca en este instante, o `null` si ninguno.
 *
 * Cada texto dice qué PUEDE hacer el cliente ya, no solo que espere: quien abre
 * el menú un rato antes de la apertura viene decidido, y si lo único que lee es
 * "todavía no", se va.
 */
export function serviceNoticeAt(ms: number, profile: RestaurantProfile = restaurantProfile()): ServiceNotice | null {
  const moment = serviceMomentAt(ms, profile);

  switch (moment.kind) {
    case 'open':
      return null;

    case 'opening':
      return {
        kind: 'opening',
        title: 'Estamos abriendo',
        body: `Abrimos a las ${moment.opens}, pero ya puedes ir armando tu pedido.`,
      };

    // El tramo del cierre no es "abierto" —prometerlo sería mentir la mitad de
    // las noches— ni "cerrado" —decirlo echa a un cliente al que sí se le
    // habría preparado—. La respuesta honesta es "preguntamos y te decimos".
    case 'after_hours':
      return {
        kind: 'after_hours',
        title: 'Puede que todavía alcancemos',
        body:
          `Nuestro horario termina a las ${moment.closes}, pero a veces la cocina sigue ` +
          'abierta. Manda tu pedido y consultamos si aún te lo podemos preparar.',
      };

    // La única franja en la que no hay nadie en la cocina: dice cuándo se abre
    // y NO promete que el pedido se prepara ya.
    case 'closed': {
      const cuando =
        moment.opens === null
          ? 'Todavía no tenemos hora de apertura.'
          : moment.opensInDays === 0
            ? `Abrimos hoy a las ${moment.opens}.`
            : moment.opensInDays === 1
              ? `Abrimos mañana a las ${moment.opens}.`
              : `Abrimos el ${DAY_NAMES[moment.opensWeekday]} a las ${moment.opens}.`;
      return {
        kind: 'closed',
        title: 'Estamos cerrados',
        body: `${cuando} Puedes dejar tu pedido armado, pero recién lo preparamos cuando abramos.`,
      };
    }
  }
}
