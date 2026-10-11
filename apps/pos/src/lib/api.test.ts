import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, normalizeError } from './api';
import { slugify } from './text';

describe('normalizeError', () => {
  it('conserva code, message y details del backend', () => {
    const error = normalizeError(409, { code: 'product_unavailable', message: 'x', details: { productId: 'p1' } });
    expect(error).toMatchObject({ status: 409, code: 'product_unavailable', message: 'x', details: { productId: 'p1' } });
  });

  it('une el arreglo de mensajes de validación en un solo texto', () => {
    const error = normalizeError(400, { code: 'http_error', message: ['price must not be less than 0', 'name should not be empty'] });
    expect(error.message).toBe('price must not be less than 0; name should not be empty');
  });

  it('aguanta un cuerpo que no es JSON', () => {
    expect(normalizeError(502, 'Bad Gateway')).toMatchObject({ code: 'http_error', message: 'Bad Gateway' });
    expect(normalizeError(500, null).message).toBe('Error 500');
  });
});

describe('errorMessage', () => {
  it('traduce los códigos conocidos', () => {
    expect(errorMessage(new ApiError(409, 'cash_register_closed', 'raw'))).toMatch(/caja/i);
  });

  it('usa el mensaje del backend cuando no conoce el código', () => {
    expect(errorMessage(new ApiError(409, 'algo_nuevo', 'Detalle del backend'))).toBe('Detalle del backend');
  });

  it('avisa de permisos en un 403', () => {
    expect(errorMessage(new ApiError(403, 'http_error', 'Forbidden'))).toMatch(/permiso/);
  });
});

describe('slugify', () => {
  it('arma un código sin acentos ni espacios', () => {
    expect(slugify('Jugo de Piña 1L')).toBe('jugo_de_pina_1l');
  });
});
