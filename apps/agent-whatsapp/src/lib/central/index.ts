import 'server-only';

/**
 * LA FRONTERA con el POS: lo único de esta carpeta que el resto del agente
 * puede importar (junto con `./contract`, que son solo tipos y constantes).
 *
 * Fuera de aquí nadie sabe qué POS hay detrás ni cómo se le habla. Cambiar de
 * POS es cambiar `CENTRAL_API_BASE_URL` y `CENTRAL_API_TOKEN`; si además hay
 * que adaptar algo, se adapta dentro de esta carpeta y nada más se entera.
 *
 * ESLint (`no-restricted-imports`) rechaza un import a cualquier otro archivo
 * de `@/lib/central/` desde fuera.
 */
export { centralRequest, isCentralEnabled } from './client';
export {
  fetchCentralProductImage,
  loadCentralCatalog,
  loadCentralCatalogForModel,
  loadCentralProfile,
  type CentralCatalog,
} from './catalog-service';
export { createCentralWebOrder } from './orders';
export { centralCashPorts, centralLocationPorts, quoteCentralDelivery, runStaffAction } from './webhook-ports';
export {
  handleGatewayLocationRequest,
  handleGatewayMessage,
  handleGatewayTelegramAlert,
} from './gateway';
export { buildGatewayDeps } from './gateway-deps';
