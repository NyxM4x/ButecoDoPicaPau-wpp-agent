import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { baseSystemPrompt, systemPromptForMode } from '@/lib/agent/business/prompt';
import { createGetMenuItemsTool, createSendMenuTool } from '@/lib/agent/tools/menu-tools';
import { buildHandoffNotice } from '@/lib/alerts/handoff-notice';
import {
  buildMenuCtaPayload,
  cashPolicyText,
  localAddressText,
  menuCtaBodyText,
  menuCtaWelcomeText,
  menuUrl,
  pickupUnavailableText,
} from '@/lib/kapso/messages';
import type { MenuCtaContext } from '@/lib/menu/cta-context';
import type { MenuSendReason } from '@/lib/menu/dispatch';
import { serviceNoticeAt } from '@/lib/menu/service-hours';
import { formatBs } from '@/lib/orders/calculate';
import { orderConfirmedByCashText } from '@/lib/orders/notifications/notify-text';
import { BASE_PROFILE, OTHER_PROFILE } from '@/test/profiles';
import { setRestaurantProfile } from './profile';

/**
 * LA PRUEBA DE LA FASE 2: con otro restaurante, nada dice el de las pruebas.
 *
 * El agente nació para otro local, con su nombre, su horario, su dirección y
 * sus reglas escritos en el código. Aquí se pone un restaurante distinto en
 * todo y se recorre lo que el agente dice: al cliente, al modelo y al personal.
 */

/** Todo lo que delataría al restaurante de las pruebas (`BASE_PROFILE`). */
const HUELLAS = [
  /buteco|pica-pau/i,
  /tablas y carnes/i,
  /Banzer|tercer anillo/i,
  /Bolivia|Santa Cruz/i,
  /\bBs\b/,
  /19:00|04:00/,
  /siete de la tarde/i,
  /agente-buteco/i,
];

function textosDelAgente(): Record<string, string> {
  const reasons: MenuSendReason[] = ['explicit_request', 'explicit_resend', 'agent_suggestion', 'qa_trigger'];
  const contexts: Array<MenuCtaContext | null> = [null, 'cash', 'price', 'delivery', 'dictated', 'greeting'];
  const textos: Record<string, string> = {
    'prompt base': baseSystemPrompt(),
    'prompt con pedidos en pausa': systemPromptForMode({ cashAllowed: true, ordersPaused: true }),
    'prompt sin efectivo': systemPromptForMode({ cashAllowed: false }),
    'prompt en promoción': systemPromptForMode({ cashAllowed: false, active: true }),
    'saludo del menú': menuCtaWelcomeText(),
    'enlace del menú': menuUrl(),
    'mensaje del menú': JSON.stringify(buildMenuCtaPayload('5511900000001')),
    'dónde queda': localAddressText(),
    'dónde queda, sin recojo': localAddressText({ pickupAllowed: false }),
    'sin recojo': pickupUnavailableText('ORD-000001'),
    'política de efectivo': cashPolicyText({ orderNumber: 'ORD-000001', foodAmount: 50, deliveryAmount: 10 } as never),
    'pedido confirmado en efectivo': orderConfirmedByCashText('ORD-000001', 72, 'delivery'),
    'un monto': formatBs(57),
    'aviso al personal': buildHandoffNotice({ customerPhone: '5511900000001', reason: 'complaint', lastMessage: 'hola' } as never),
    'herramienta get_menu_items': createGetMenuItemsTool({} as never).definition.description,
    'herramienta send_menu': createSendMenuTool({} as never).definition.description,
  };
  for (const reason of reasons) {
    for (const context of contexts) {
      for (const cashAllowed of [true, false]) {
        textos[`botón del menú: ${reason}/${context}/efectivo ${cashAllowed}`] = menuCtaBodyText(reason, context, { cashAllowed });
      }
    }
  }
  // Un día entero, cada cuarto de hora: los cuatro avisos de horario.
  const medianoche = Date.parse('2026-09-08T03:00:00.000Z');
  for (let minuto = 0; minuto < 1440; minuto += 15) {
    const aviso = serviceNoticeAt(medianoche + minuto * 60_000);
    if (aviso) textos[`aviso de horario ${aviso.kind}`] = `${aviso.title} ${aviso.body}`;
  }
  return textos;
}

/**
 * Otro restaurante es otro perfil Y otro despliegue: la URL pública del agente
 * (`APP_BASE_URL`) también es la suya.
 */
function otroRestaurante(profile = OTHER_PROFILE): void {
  setRestaurantProfile(profile);
  process.env.APP_BASE_URL = 'https://bardoze.example';
}

describe('con otro restaurante, nada dice el de las pruebas', () => {
  const urlDeLasPruebas = process.env.APP_BASE_URL;
  afterEach(() => {
    process.env.APP_BASE_URL = urlDeLasPruebas;
  });

  it('ningún texto del agente conserva datos del restaurante anterior', () => {
    otroRestaurante();
    const hallazgos: string[] = [];
    for (const [nombre, texto] of Object.entries(textosDelAgente())) {
      for (const huella of HUELLAS) {
        const match = texto.match(huella);
        if (match) hallazgos.push(`${nombre}: «${match[0]}»`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it('y sí dice lo del restaurante nuevo', () => {
    otroRestaurante();
    const textos = textosDelAgente();

    expect(textos['prompt base']).toContain('Eres el asistente de WhatsApp de Bar do Zé, un bar de comida brasileña en São Paulo.');
    expect(textos['prompt base']).toContain('Siempre en portugués, con el trato cercano y directo que se usa en Brasil.');
    expect(textos['prompt base']).toContain('Horario de atención: de martes a domingo de 18:00 a 02:00 (lunes cerrado).');
    expect(textos['prompt base']).toContain('Rua das Flores 100, Vila Madalena');
    // Este local sí entrega en mano: el prompt no puede negar el recojo.
    expect(textos['prompt base']).toContain('Se puede pasar a retirar el pedido por el local');
    expect(textos['prompt base']).not.toContain('No hay recojo');

    expect(textos['saludo del menú']).toContain('Hola, soy Bar do Zé 👋 Atendemos de martes a domingo de 18:00 a 02:00 (lunes cerrado).');
    expect(textos['dónde queda']).toContain('https://maps.example/bar-do-ze');
    expect(textos['enlace del menú']).toBe('https://bardoze.example/menu');
    expect(textos['un monto']).toBe('R$ 57');
    expect(textos['pedido confirmado en efectivo']).toContain('R$ 72');
    expect(textos['aviso al personal']).toContain('Atención humana — Bar do Zé');
    expect(textos['herramienta get_menu_items']).toContain('Bar do Zé');
    // Lo que el local pidió que se sepa entra al prompt, tal cual.
    expect(textos['prompt base']).toContain('Las mesas se reservan por WhatsApp; las confirma una persona del bar.');
    // Sin video ni imagen en el perfil, el botón del menú sale sin cabecera.
    expect(textos['mensaje del menú']).not.toContain('"header"');
  });

  it('el mismo recorrido con el perfil de las pruebas sí encuentra las huellas', () => {
    // Si esta prueba fallara, la de arriba no estaría mirando nada.
    setRestaurantProfile(BASE_PROFILE);
    const todo = Object.values(textosDelAgente()).join('\n');
    for (const huella of HUELLAS) expect(todo, String(huella)).toMatch(huella);
  });

  it('un local sin envío no lo ofrece', () => {
    otroRestaurante({ ...OTHER_PROFILE, deliveryEnabled: false });
    const prompt = baseSystemPrompt();
    expect(prompt).toContain('No hacen envíos a domicilio');
    expect(prompt).toContain('No hay envíos a domicilio');
    expect(prompt).not.toContain('Sí hacen delivery');
    expect(prompt).not.toContain('le pides que te comparta su ubicación');
  });
});

// ── Y que nadie lo vuelva a escribir ────────────────────────────────────────

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('el código no nombra a ningún restaurante', () => {
  it('fuera de las pruebas, no queda en src/ ni el restaurante de las pruebas ni la demo anterior', () => {
    // También en los comentarios: un ejemplo con el nombre de un local es un
    // dato de ese local, y el siguiente que copie el comentario se lo lleva.
    const permitidos = [/\.test\.tsx?$/, /\.fixtures\.ts$/, /[\\/]test[\\/]/];
    const huellas = /zarco|sarco-restaurant|trancapecho|trancaburguer|salchiburguer|salchipapa|lomito|hamburguesa|buteco|pica-?pau/i;
    const hallazgos: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (permitidos.some((pattern) => pattern.test(file))) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (huellas.test(line)) {
            hallazgos.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(hallazgos).toEqual([]);
  });
});
