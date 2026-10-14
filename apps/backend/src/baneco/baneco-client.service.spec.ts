import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { BanecoClientService } from './baneco-client.service';

const BASE_URL = 'https://banco.example/ApiGateway';

const SETTINGS = {
  baseUrl: BASE_URL,
  username: 'comercio',
  password: 'clave',
  aesKey: 'LLAVE',
  account: '1234567890',
};

interface Call {
  method: string;
  url: string;
  body: unknown;
  authorization: string | null;
}

/** Un JWT con el `exp` que se le pida; la firma no importa. */
function tokenExpiringAt(epochSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ exp: epochSeconds })}.firma`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Un banco de mentira: contesta por ruta y guarda cada llamada. `routes`
 * recibe la ruta sin la base y devuelve la respuesta; lo que no esté ahí es
 * el cifrado o la autenticación.
 */
function mockBank(
  routes: (path: string, call: Call) => Response | undefined,
  options: { tokens?: string[] } = {},
) {
  const calls: Call[] = [];
  const tokens = [...(options.tokens ?? [])];
  const fetchMock = jest.fn(async (input: string | URL, init?: RequestInit) => {
    if (init?.method === 'GET' && init.body !== undefined) {
      // Lo que hace `fetch` de verdad: un GET no admite cuerpo.
      throw new TypeError('Request with GET/HEAD method cannot have body.');
    }
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers.get('authorization'),
    };
    calls.push(call);

    const path = url.slice(BASE_URL.length);
    if (path.startsWith('/api/authentication/encrypt')) {
      const text = new URL(url).searchParams.get('text');
      return new Response(JSON.stringify(`cifrado(${text})`), { status: 200 });
    }
    if (path === '/api/authentication/authenticate') {
      return json({
        token: tokens.shift() ?? 'token-sin-vencimiento',
        responseCode: 0,
        message: '',
      });
    }
    return routes(path, call) ?? json({ responseCode: 99, message: 'ruta no simulada' }, 404);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { calls, requests: (path: string) => calls.filter((c) => c.url.endsWith(path)) };
}

function makeClient(settings: Partial<typeof SETTINGS> = {}) {
  const config = {
    get: () => ({ ...SETTINGS, ...settings }),
  } as unknown as ConfigService<AppConfig, true>;
  return new BanecoClientService(config);
}

describe('BanecoClientService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  describe('generateQR', () => {
    it('manda la cuenta cifrada y el cuerpo que pide el manual', async () => {
      const bank = mockBank((path) =>
        path === '/api/qrsimple/generateQR'
          ? json({ qrId: 'QR-1', qrImage: 'aW1hZ2Vu', responseCode: 0, message: '' })
          : undefined,
      );

      const result = await makeClient().generateQR({
        transactionId: 'ORD-000001',
        amount: 62.5,
        description: 'Pedido ORD-000001',
        dueDate: '2026-10-14',
      });

      expect(result).toMatchObject({ qrId: 'QR-1', qrImageBase64: 'aW1hZ2Vu' });
      const [request] = bank.requests('/api/qrsimple/generateQR');
      expect(request.method).toBe('POST');
      expect(request.authorization).toBe('Bearer token-sin-vencimiento');
      expect(request.body).toEqual({
        transactionId: 'ORD-000001',
        accountCredit: 'cifrado(1234567890)',
        currency: 'BOB',
        amount: 62.5,
        description: 'Pedido ORD-000001',
        dueDate: '2026-10-14',
        singleUse: true,
        modifyAmount: false,
      });
      // La contraseña también viaja cifrada.
      expect(bank.requests('/api/authentication/authenticate')[0].body).toEqual({
        userName: 'comercio',
        password: 'cifrado(clave)',
      });
    });

    it('recorta la nota a lo que admite el banco y rechaza un identificador largo', async () => {
      const bank = mockBank((path) =>
        path === '/api/qrsimple/generateQR'
          ? json({ qrId: 'QR-1', qrImage: 'aW1hZ2Vu', responseCode: 0 })
          : undefined,
      );
      const client = makeClient();

      await client.generateQR({
        transactionId: 'ORD-000001',
        amount: 10,
        description: 'x'.repeat(140),
        dueDate: '2026-10-14',
      });
      const sent = bank.requests('/api/qrsimple/generateQR')[0].body as { description: string };
      expect(sent.description).toHaveLength(100);

      await expect(
        client.generateQR({
          transactionId: 'x'.repeat(31),
          amount: 10,
          description: 'Pedido',
          dueDate: '2026-10-14',
        }),
      ).rejects.toThrow('máximo 30');
    });

    it('lanza si el banco rechaza el QR', async () => {
      mockBank((path) =>
        path === '/api/qrsimple/generateQR'
          ? json({ responseCode: 5, message: 'Cuenta inválida' })
          : undefined,
      );

      await expect(
        makeClient().generateQR({
          transactionId: 'ORD-000001',
          amount: 10,
          description: 'Pedido',
          dueDate: '2026-10-14',
        }),
      ).rejects.toThrow('Cuenta inválida');
    });
  });

  describe('statusQR', () => {
    it('usa la ruta v2 con el id en la dirección y sin cuerpo', async () => {
      const bank = mockBank((path) =>
        path === '/api/qrsimple/v2/statusQR/21061401016000000006'
          ? json({ statusQrCode: 0, responseCode: 0, message: '' })
          : undefined,
      );

      await expect(makeClient().statusQR('21061401016000000006')).resolves.toMatchObject({
        statusQrCode: 0,
        payment: null,
      });
      const [request] = bank.requests('/api/qrsimple/v2/statusQR/21061401016000000006');
      expect(request.method).toBe('GET');
      expect(request.body).toBeUndefined();
    });

    it('devuelve el pago cuando está pagado, venga como lista o como objeto', async () => {
      const payment = {
        qrId: 'QR-1',
        transactionId: '1236342',
        amount: 62,
        senderName: 'PEDRO PEREZ',
      };
      mockBank((path) =>
        path.endsWith('/QR-lista')
          ? json({ statusQrCode: 1, payment: [payment], responseCode: 0 })
          : path.endsWith('/QR-objeto')
            ? json({ statusQRCode: 1, payment, responseCode: 0 })
            : undefined,
      );
      const client = makeClient();

      await expect(client.statusQR('QR-lista')).resolves.toMatchObject({
        statusQrCode: 1,
        payment,
      });
      // El manual escribe el campo de dos maneras: `statusQrCode` y `statusQRCode`.
      await expect(client.statusQR('QR-objeto')).resolves.toMatchObject({
        statusQrCode: 1,
        payment,
      });
    });

    it('lanza en vez de dar por pendiente un estado que no entiende', async () => {
      mockBank((path) =>
        path.endsWith('/QR-error')
          ? json({ responseCode: 3, message: 'QR inexistente' })
          : path.endsWith('/QR-raro')
            ? json({ statusQrCode: 4, responseCode: 0 })
            : path.endsWith('/QR-vacio')
              ? json({ responseCode: 0 })
              : undefined,
      );
      const client = makeClient();

      await expect(client.statusQR('QR-error')).rejects.toThrow('QR inexistente');
      await expect(client.statusQR('QR-raro')).rejects.toThrow('estado desconocido');
      await expect(client.statusQR('QR-vacio')).rejects.toThrow('estado desconocido');
    });
  });

  describe('cancelQR', () => {
    it('manda el qrId en el cuerpo del DELETE', async () => {
      const bank = mockBank((path) =>
        path === '/api/qrsimple/cancelQR' ? json({ responseCode: 0, message: '' }) : undefined,
      );

      await makeClient().cancelQR('QR-1');
      const [request] = bank.requests('/api/qrsimple/cancelQR');
      expect(request.method).toBe('DELETE');
      expect(request.body).toEqual({ qrId: 'QR-1' });
    });

    it('lanza si el banco no lo anuló (por ejemplo, porque ya está pagado)', async () => {
      mockBank((path) =>
        path === '/api/qrsimple/cancelQR'
          ? json({ responseCode: 7, message: 'El QR ya fue pagado' })
          : undefined,
      );

      await expect(makeClient().cancelQR('QR-1')).rejects.toThrow('ya fue pagado');
    });
  });

  describe('token', () => {
    const ok = () => json({ statusQrCode: 0, responseCode: 0 });

    it('se reutiliza entre llamadas', async () => {
      const bank = mockBank(ok);
      const client = makeClient();

      await client.statusQR('QR-1');
      await client.statusQR('QR-2');
      expect(bank.requests('/api/authentication/authenticate')).toHaveLength(1);
    });

    it('se renueva antes de vencer, según su campo exp', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-14T03:00:00.000Z') });
      const nowSeconds = Date.now() / 1000;
      const bank = mockBank(ok, {
        tokens: [tokenExpiringAt(nowSeconds + 30 * 60), tokenExpiringAt(nowSeconds + 60 * 60)],
      });
      const client = makeClient();

      await client.statusQR('QR-1');
      jest.setSystemTime(Date.now() + 20 * 60_000);
      await client.statusQR('QR-2');
      expect(bank.requests('/api/authentication/authenticate')).toHaveLength(1);

      // A medio minuto de vencer ya no se usa.
      jest.setSystemTime(Date.now() + 9.5 * 60_000);
      await client.statusQR('QR-3');
      expect(bank.requests('/api/authentication/authenticate')).toHaveLength(2);
    });

    it('se renueva y reintenta una vez ante un 401', async () => {
      let rejected = false;
      const bank = mockBank(
        () => {
          if (!rejected) {
            rejected = true;
            return json({ message: 'token vencido' }, 401);
          }
          return ok();
        },
        { tokens: ['token-viejo', 'token-nuevo'] },
      );

      await expect(makeClient().statusQR('QR-1')).resolves.toMatchObject({ statusQrCode: 0 });
      const attempts = bank.requests('/api/qrsimple/v2/statusQR/QR-1');
      expect(attempts.map((call) => call.authorization)).toEqual([
        'Bearer token-viejo',
        'Bearer token-nuevo',
      ]);
    });
  });

  describe('configuración', () => {
    it('dice qué variables faltan, sin llamar al banco', async () => {
      const bank = mockBank(() => undefined);
      const client = makeClient({ password: '', account: '' });

      expect(client.missingSettings()).toEqual(['BANECO_PASSWORD', 'BANECO_ACCOUNT']);
      await expect(client.statusQR('QR-1')).rejects.toThrow(
        'falta BANECO_PASSWORD, BANECO_ACCOUNT',
      );
      expect(bank.calls).toHaveLength(0);
    });

    it('completa = nada falta', () => {
      expect(makeClient().missingSettings()).toEqual([]);
    });
  });
});
