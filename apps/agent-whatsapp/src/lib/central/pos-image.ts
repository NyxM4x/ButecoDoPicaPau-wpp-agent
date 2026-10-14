/**
 * Imágenes que el POS guarda bajo llave y hay que mandar por WhatsApp: el QR
 * de pago.
 *
 * El POS no publica esa imagen: la entrega en una ruta suya que pide el token
 * de servicio (`/orders/:id/qr-image`), y manda esa ruta en `imageUrl`.
 * WhatsApp no puede abrirla, así que el agente la descarga con su token, sube
 * los bytes a la Media API y envía el mensaje con el id que recibe. La imagen
 * nunca tiene una dirección pública.
 *
 * Módulo puro: recibe con qué descargar, subir y enviar.
 */
import type { GatewaySendResult } from './gateway';

/** Lo mismo que acepta WhatsApp como imagen, y su tope de 5 MB. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
const MAX_BYTES = 5 * 1024 * 1024;

export interface PosImageDeps {
  /** `GET` a una ruta del POS con el token de servicio. */
  fetchFile(path: string): Promise<Response>;
  uploadImage(
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ ok: true; mediaId: string } | { ok: false; error: string; status?: number }>;
  sendImageById(to: string, mediaId: string, caption: string): Promise<GatewaySendResult>;
}

/**
 * ¿Es una ruta del propio POS? Empieza con una sola barra y no trae nada con
 * lo que salirse de él: ni `//otro-servidor`, ni `\`, ni `..`.
 */
export function isPosImagePath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.split(/[/?#]/).includes('..') &&
    !/\s/.test(value)
  );
}

/**
 * Descarga la imagen del POS y la manda por WhatsApp con `caption` como pie.
 *
 * No lanza. Los errores siguen la regla del gateway: los que empiezan con
 * `invalid_` no se arreglan reintentando (el POS entregó algo que no es una
 * imagen); el resto sí (el POS o Kapso no respondieron).
 */
export async function sendPosImage(
  to: string,
  path: string,
  caption: string,
  deps: PosImageDeps,
): Promise<GatewaySendResult> {
  if (!isPosImagePath(path)) return { ok: false, error: 'invalid_image' };

  let response: Response;
  try {
    response = await deps.fetchFile(path);
  } catch {
    return { ok: false, error: 'pos_image_unavailable' };
  }
  if (!response.ok) return { ok: false, error: 'pos_image_unavailable', status: response.status };

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!IMAGE_TYPES.has(contentType)) return { ok: false, error: 'invalid_image' };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, error: 'pos_image_unavailable' };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: 'invalid_image' };
  }

  const uploaded = await deps.uploadImage(bytes, contentType);
  if (!uploaded.ok) return uploaded;
  return deps.sendImageById(to, uploaded.mediaId, caption);
}
