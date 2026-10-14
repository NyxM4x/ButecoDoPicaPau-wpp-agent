# Flujos de conversación para Buteco do Pica-Pau

Última revisión: 2026-10-14.

Qué hace el agente de WhatsApp con cada cosa que puede escribir un cliente de
Buteco, si eso ya sirve para este restaurante y qué falta. Sale de revisar el
código del agente (`apps/agent-whatsapp/src/lib/webhook`, `lib/agent`) con la
carta del volante.

## Cómo decide el agente

Cada mensaje pasa por filtros fijos, en este orden, y el primero que reconoce
el mensaje lo contesta:

```text
mensaje del cliente
  │
  ├─ ¿una persona del equipo está atendiendo? ──────────► nada (pausa)
  ├─ saludo, «menú», «quiero pedir», pedido dictado ────► botón del menú
  ├─ ubicación de WhatsApp ─────────────────────────────► cotiza el envío (POS)
  ├─ «cuánto sale el envío» ────────────────────────────► le pide la ubicación
  ├─ cambios sobre un pedido abierto (nota, recojo…) ───► ver «Después de pedir»
  │
  └─ lo demás ─► asistente con IA, que elige UNA acción:
                   send_menu        mandar el menú (varios productos, «qué hay»)
                   get_menu_items   consultar uno o dos productos en el POS
                   answer_directly  contestar hablando
                   request_human    pasar a una persona (pausa 2 h + Telegram)
```

Si nada encaja, el cliente recibe el botón del menú: es la respuesta por
defecto.

## Lo que el asistente sabe del local

Sin consultar nada, solo sabe: el horario, la dirección con su enlace de Maps,
si hay envío y **lo que el local le pida que sepa** (`RESTAURANT_FACTS`, nuevo
desde el 2026-10-14). Los productos y precios los consulta siempre en el POS.

Antes de `RESTAURANT_FACTS`, cualquier pregunta propia de Buteco —cómo reservo,
qué trae la tablita, cuánto tarda— se contestaba con «no tengo esa
información». La propuesta para Buteco, sacada del volante (ya cargada en el
`.env.local`; en Vercel va igual, una frase por línea):

```text
Las tablitas para 1 y 2 personas traen arroz, plátano, salsa de ajo y ají; la carne se elige.
Las tablas para compartir traen arroz, plátano, salsa de ajo y limón, con carnes a elección: Tabla de Zeus 2 carnes (2 a 3 personas), Tabla Hércules 3 carnes (3 a 4), Tabla Spartacus 3 carnes (4 a 5), Tabla de los Dioses 4 carnes (5 a 8), Super Tabla L 5 carnes (15 a 17) y Super Tabla XL 7 carnes (20 a 30).
La comida se prepara al momento: la espera es de 30 a 40 minutos.
La sopa de maní sale solo los sábados y domingos.
Las reservas de mesa se piden por WhatsApp al 695 95015: día, hora, cuántos son y a nombre de quién. Las confirma una persona del local.
Hay combos de cumpleaños con reserva. Con la Super Tabla L o XL: video editado, fotos con los invitados, cumpleaños feliz, vela lluvia de oro, tablita cumpleañera, banda y vino para los invitados. Con una tabla mediana (Dioses, Spartacus, Hércules o Zeus): cumpleaños feliz, vela lluvia de oro, jarra de limonada de 2 litros y fotos. El festejado presenta su carnet el día del evento.
Instagram: @buteco.do.picapau.scz
```

Dos reglas nuevas del prompt, pensadas para Buteco pero sin nombrarlo:

- **Para cuántas personas es una tabla se puede decir**, si lo dice la
  descripción del producto o la información del local. Orientar a un grupo de 6
  hacia la Tabla de los Dioses es leer un dato, no recomendar.
- **El asistente nunca confirma ni anota una reserva**: explica cómo se
  reserva. Si hay mesa lo decide una persona.

## Los flujos, uno por uno

### Antes de pedir

| El cliente… | Qué pasa | ¿Sirve para Buteco? |
|---|---|---|
| Saluda, pide el menú o «quiero pedir» | Botón del menú, con el saludo y el horario | Sí. Falta el video o la imagen del botón (`MENU_VIDEO_URL`) |
| Pregunta qué hay («qué tablas tienen», «qué bebidas») | Le manda el menú; no lo enumera en el chat | Sí |
| Pregunta el precio de uno o dos productos | Lo consulta en el POS y contesta | Sí, cuando la carta real esté cargada |
| Dicta el pedido por chat («2 tablitas de costilla») | Lo reconoce y le manda el menú para armarlo | Sí |
| Pregunta qué trae un plato, cuánto tarda, si hay sopa | Contesta con la información del local | Sí, con `RESTAURANT_FACTS` |
| Pregunta qué tabla le conviene para su grupo | Usa el dato de personas de la descripción o de la información del local | Sí (regla nueva) |
| Pide la mejor, la más rica | No elige: «todas están buenísimas» | Sí |
| Pregunta por alergias o ingredientes | No afirma nada que no tenga escrito | Sí |
| Pregunta el horario o la dirección | Los da del perfil, sin decir si está abierto ahora | **Faltan los datos reales** (dirección, enlace de Maps, horario por día) |
| Pregunta cuánto sale el envío | Le pide la ubicación y el POS la cotiza | **Las tarifas son de otro proyecto**: ver «Envío» |
| Pregunta si hay otra sucursal | «Es nuestro único local» | Sí |

### Reservas y cumpleaños (lo nuevo de Buteco)

| El cliente… | Qué pasa hoy | Qué falta |
|---|---|---|
| Pregunta cómo reservar | Explica cómo, con la información del local | Confirmar el número de reservas |
| Escribe «quiero reservar para el sábado, somos 10» | Explica cómo se reserva; no la confirma | Decidir el flujo (abajo) |
| Pregunta por cumpleaños | Cuenta los dos combos y que van con reserva | Saber si se cobran aparte |
| Usa el formulario de reserva del menú web | **Apagado**: abre el chat del bot con la reserva escrita, y el bot no sabe qué hacer con ese mensaje | Decidir el flujo (abajo) |

**La decisión de las reservas.** El volante dice «Reservas: 695 95015». Si ese
número NO es el del bot, el camino es corto: el asistente ya lo dice, y el
formulario del menú abre el chat de ese número (hay que separar
`WHATSAPP_BUSINESS_NUMBER` del número de reservas, poco trabajo). Si es el
MISMO número del bot, hace falta un flujo nuevo:

1. Reconocer el mensaje de reserva (el del formulario tiene formato fijo; el
   escrito a mano lo reconoce el asistente).
2. Avisar al grupo de Telegram con los datos y botones **Confirmar** /
   **Rechazar**, como los de Listo / Salió / Entregado.
3. Contestarle al cliente «recibimos tu pedido de reserva» y, al tocar el
   botón, «tu mesa está confirmada» o el motivo.

### El pedido

| Paso | Qué pasa | ¿Sirve para Buteco? |
|---|---|---|
| Arma el pedido en el menú web | Carrito, total y confirmación | Sí para tablitas y bebidas. **Las tablas para compartir no**: el carrito no guarda qué carnes eligió y la cocina no se entera |
| Envío: comparte la ubicación | El POS mide la distancia y cobra según las bandas de tarifa | **Las bandas son de otro proyecto** (Bs 10 el primer km, 12 el segundo…) y faltan las coordenadas del local |
| Retiro en el local | Si `pickupEnabled`, se elige al confirmar | Sí. El borrador lo tiene encendido |
| Paga en efectivo | Desglose con botones CONFIRMAR / CANCELAR | Sí |
| Paga por QR | El backend genera el QR de Banco Económico y el pago se confirma solo | Funciona contra el ambiente de pruebas; **faltan las credenciales de producción** |
| Pedidos pausados por saturación | Avisa que vuelva en unos minutos | Sí |

### Después de pedir

| El cliente… | Qué pasa | ¿Sirve para Buteco? |
|---|---|---|
| Pregunta «¿en qué va mi pedido?» | Pasa a una persona (pausa y aviso por Telegram) | Sí |
| El local toca Listo / Salió / Entregado en Telegram | El cliente recibe «ya está listo», «ya salió» | Sí. Falta probarlo con un bot real |
| Escribe «sin ají por favor» o «quiero cambiar algo» | **El asistente no sabe que ya pidió** y contesta como a cualquier consulta | Fase 4 del plan: el agente todavía no lee el pedido abierto del POS |
| Dice que pasa a recoger | Igual que arriba | Fase 4 |
| Manda la foto de un comprobante | Igual que arriba; con el QR del banco hace menos falta | Fase 4 |

### Cuando algo sale mal

| Situación | Qué pasa |
|---|---|
| Queja, reclamo o «quiero hablar con una persona» | `request_human`: el bot calla 2 horas y avisa al grupo de Telegram |
| Cliente trabado (8 mensajes en 30 minutos sin pedir) | El bot calla 2 horas y avisa al grupo |
| El bot dice que hace falta una persona sin haber derivado | Calla 30 minutos y avisa igual |
| Un pedido sin pagar ni confirmar | Se cancela solo (efectivo a los 20 min, QR a los 30, sin ubicación a los 45) |

## Lo que se quitó de la demo anterior (2026-10-14)

El agente nació para otro restaurante, y quedaban sus huellas:

- **En el código**: las descripciones, fotos y orden de vitrina de sus
  productos (`lib/menu/catalog.ts`), el buscador de la carta («Buscar
  hamburguesa…»), las descripciones de herramientas que lee la IA («qué
  hamburguesas hay»), los colores `donzarco-*` (ahora `brand-*`), los nombres
  de paquete y los ejemplos de todos los comentarios.
- **Archivos**: su carta de demo (`demos/don-zarco`), su logo, su video
  tutorial y **la imagen del QR de su cuenta bancaria**, que quedaba publicada
  en el sitio.
- **Base del agente**: la migración `0040_retira_carta_de_la_demo.sql` borra su
  carta de `menu_items` (apaga lo que ya tenga pedidos) y el `seed.sql` quedó
  vacío. En la base local del backend se borraron sus productos y su combo.
- **Pruebas**: el restaurante de las pruebas es ahora Buteco (con dirección y
  horario de ejemplo) y sus productos de ejemplo son tablas, keperí, alitas…
  Una prueba falla si alguien vuelve a escribir en `src/` el nombre de un
  restaurante o un producto de la demo, también en un comentario.

Queda la documentación histórica (`apps/agent-whatsapp/docs/`, parte de
`docs/`), que cuenta cómo se construyó el agente con la demo. No cambia lo que
el agente hace.

## Lo que hay que pedirle a Buteco para estos flujos

1. **Reservas**: ¿el 695 95015 es el mismo WhatsApp del bot? ¿Con cuánta
   anticipación se reserva la L y la XL? ¿Se pueden pedir por delivery?
2. **Envío**: tarifas (por km o por zonas), distancia máxima y ubicación exacta
   del local.
3. **Dirección, enlace de Maps y horario por día** (y si cierra algún día).
4. **Combos de cumpleaños**: ¿incluidos en el precio de la tabla o aparte?
5. **Carnes de las tablas para compartir**: si se pueden repetir; y decidir
   cómo llegan a la cocina (nota del pedido o una opción por línea).
6. **Sopa de maní**: ¿se apaga entre semana desde el POS o automático?
7. Las 5 carnes recortadas que faltan y el precio del biffe.
