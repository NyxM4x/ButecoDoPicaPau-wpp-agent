import { describe, expect, it, vi } from 'vitest';
import { isPosImagePath, sendPosImage, type PosImageDeps } from './pos-image';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function imageResponse(bytes: Uint8Array = PNG, contentType = 'image/png', status = 200): Response {
  return new Response(status === 200 ? Uint8Array.from(bytes) : null, {
    status,
    headers: { 'content-type': contentType },
  });
}

function deps(over: Partial<PosImageDeps> = {}) {
  return {
    fetchFile: vi.fn(async () => imageResponse()),
    uploadImage: vi.fn(async () => ({ ok: true as const, mediaId: 'media-1' })),
    sendImageById: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.QR' })),
    ...over,
  };
}

describe('isPosImagePath', () => {
  it('acepta una ruta del POS', () => {
    expect(isPosImagePath('/orders/7b0e0f6e-3f0f-4c53-9d2c-1f2f5a3e8a11/qr-image')).toBe(true);
  });

  it('rechaza todo lo que podría salirse del POS', () => {
    for (const value of [
      'https://x.test/qr.png',
      '//otro.test/qr.png',
      'orders/1/qr-image',
      '/orders/..\\secreto',
      '/orders/../secreto',
      '/..',
      '/orders/1 /qr-image',
      '',
    ]) {
      expect(isPosImagePath(value)).toBe(false);
    }
  });
});

describe('sendPosImage: el QR que el POS guarda bajo llave', () => {
  it('la descarga del POS, la sube a WhatsApp y la manda por su id', async () => {
    const d = deps();
    const result = await sendPosImage('+59170010001', '/orders/o-1/qr-image', 'Tu QR', d);

    expect(result).toEqual({ ok: true, wamid: 'wamid.QR' });
    expect(d.fetchFile).toHaveBeenCalledWith('/orders/o-1/qr-image');
    const [bytes, contentType] = vi.mocked(d.uploadImage).mock.calls[0];
    expect([...bytes]).toEqual([...PNG]);
    expect(contentType).toBe('image/png');
    expect(d.sendImageById).toHaveBeenCalledWith('+59170010001', 'media-1', 'Tu QR');
  });

  it('acepta JPEG y el tipo con parámetros', async () => {
    const d = deps({ fetchFile: vi.fn(async () => imageResponse(PNG, 'image/jpeg; charset=binary')) });
    expect((await sendPosImage('+591', '/orders/o-1/qr-image', 'Tu QR', d)).ok).toBe(true);
    expect(vi.mocked(d.uploadImage).mock.calls[0][1]).toBe('image/jpeg');
  });

  it('si el POS no responde o responde con error, se puede reintentar', async () => {
    const caido = deps({
      fetchFile: vi.fn(async () => {
        throw new Error('sin red');
      }),
    });
    const noEsta = deps({ fetchFile: vi.fn(async () => imageResponse(PNG, 'application/json', 404)) });

    expect(await sendPosImage('+591', '/orders/o-1/qr-image', 'Tu QR', caido)).toEqual({
      ok: false,
      error: 'pos_image_unavailable',
    });
    expect(await sendPosImage('+591', '/orders/o-1/qr-image', 'Tu QR', noEsta)).toEqual({
      ok: false,
      error: 'pos_image_unavailable',
      status: 404,
    });
    expect(caido.uploadImage).not.toHaveBeenCalled();
    expect(noEsta.uploadImage).not.toHaveBeenCalled();
  });

  it('lo que no es una imagen, está vacío o pesa de más no se sube', async () => {
    const html = deps({ fetchFile: vi.fn(async () => imageResponse(PNG, 'text/html')) });
    const vacia = deps({ fetchFile: vi.fn(async () => imageResponse(new Uint8Array(0))) });
    const enorme = deps({
      fetchFile: vi.fn(async () => imageResponse(new Uint8Array(5 * 1024 * 1024 + 1))),
    });

    for (const d of [html, vacia, enorme]) {
      expect(await sendPosImage('+591', '/orders/o-1/qr-image', 'Tu QR', d)).toEqual({
        ok: false,
        error: 'invalid_image',
      });
      expect(d.uploadImage).not.toHaveBeenCalled();
    }
  });

  it('una ruta que no es del POS ni siquiera se pide', async () => {
    const d = deps();
    expect(await sendPosImage('+591', 'https://x.test/qr.png', 'Tu QR', d)).toEqual({
      ok: false,
      error: 'invalid_image',
    });
    expect(d.fetchFile).not.toHaveBeenCalled();
  });

  it('si la subida falla, el mensaje no sale y el error llega tal cual', async () => {
    const d = deps({
      uploadImage: vi.fn(async () => ({ ok: false as const, error: 'http_error', status: 500 })),
    });
    expect(await sendPosImage('+591', '/orders/o-1/qr-image', 'Tu QR', d)).toEqual({
      ok: false,
      error: 'http_error',
      status: 500,
    });
    expect(d.sendImageById).not.toHaveBeenCalled();
  });
});
