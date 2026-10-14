import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface GenerateQrParams {
  /** Identificador del cobro en nuestro sistema. El banco admite hasta 30 caracteres. */
  transactionId: string;
  amount: number;
  /** Nota del cobro. El banco admite hasta 100 caracteres; lo que sobre se recorta. */
  description: string;
  /** Formato YYYY-MM-DD — es el único nivel de granularidad que acepta el banco. */
  dueDate: string;
}

export interface GenerateQrResult {
  qrId: string;
  qrImageBase64: string;
  raw: unknown;
}

/** 0 = pendiente de pago, 1 = pagado, 9 = anulado. */
export type StatusQrCode = 0 | 1 | 9;

/** El pago tal como lo informa el banco (objeto `PaymentQR`, Anexo 1 del manual). */
export interface BanecoPayment {
  qrId?: string;
  /** Número de transacción del banco, no el nuestro. */
  transactionId?: string;
  paymentDate?: string;
  paymentTime?: string;
  currency?: string;
  amount?: number;
  senderBankCode?: string;
  senderName?: string;
  senderAccount?: string;
  description?: string;
}

export interface StatusQrResult {
  statusQrCode: StatusQrCode;
  /** Solo cuando está pagado. */
  payment: BanecoPayment | null;
  raw: unknown;
}

export const BANECO_TRANSACTION_ID_MAX = 30;
export const BANECO_DESCRIPTION_MAX = 100;

/** Una llamada al banco que no contesta no puede dejar colgado al cron que la hizo. */
const REQUEST_TIMEOUT_MS = 15_000;
/** El token se renueva un poco antes de vencer, no en el último segundo. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const REQUIRED_SETTINGS = [
  ['baseUrl', 'BANECO_BASE_URL'],
  ['username', 'BANECO_USERNAME'],
  ['password', 'BANECO_PASSWORD'],
  ['aesKey', 'BANECO_AES_KEY'],
  ['account', 'BANECO_ACCOUNT'],
] as const;

interface CachedToken {
  value: string;
  /** `null` = el token no dice cuándo vence; se renueva al primer 401. */
  expiresAtMs: number | null;
}

interface BanecoEnvelope {
  responseCode?: number;
  message?: string;
}

/**
 * Cliente HTTP de la API QR de Banco Económico («API Market», manual de
 * especificaciones técnicas v1.3.0).
 *
 * El token dura 30 minutos (lo dice su campo `exp`): se guarda en memoria, se
 * renueva antes de vencer y, por si el banco lo invalida antes, también ante
 * un 401.
 */
@Injectable()
export class BanecoClientService {
  private readonly logger = new Logger(BanecoClientService.name);
  private cachedToken: CachedToken | null = null;
  private cachedEncryptedAccount: string | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Las variables `BANECO_*` que faltan. Vacío = el cobro por QR está configurado. */
  missingSettings(): string[] {
    const settings = this.config.get('baneco', { infer: true });
    return REQUIRED_SETTINGS.filter(([key]) => !settings[key]).map(([, envName]) => envName);
  }

  async generateQR(params: GenerateQrParams): Promise<GenerateQrResult> {
    if (params.transactionId.length > BANECO_TRANSACTION_ID_MAX) {
      // Un identificador no se recorta: dos cobros distintos podrían quedar iguales.
      throw new Error(
        `generateQR: transactionId de ${params.transactionId.length} caracteres (máximo ${BANECO_TRANSACTION_ID_MAX}).`,
      );
    }
    const accountCredit = await this.getEncryptedAccount();
    const raw = await this.authenticatedRequest<
      BanecoEnvelope & { qrId?: string; qrImage?: string }
    >('POST', '/api/qrsimple/generateQR', {
      transactionId: params.transactionId,
      accountCredit,
      currency: 'BOB',
      amount: params.amount,
      description: params.description.slice(0, BANECO_DESCRIPTION_MAX),
      dueDate: params.dueDate,
      singleUse: true,
      modifyAmount: false,
    });
    if (raw.responseCode !== 0 || !raw.qrId || !raw.qrImage) {
      throw new Error(`generateQR falló: responseCode=${raw.responseCode} message=${raw.message}`);
    }
    return { qrId: raw.qrId, qrImageBase64: raw.qrImage, raw };
  }

  /**
   * `GET /v2/statusQR/{id}` (manual, 7.4). La versión anterior recibía el
   * `qrId` en el cuerpo de un GET, que `fetch` no permite enviar.
   *
   * Lanza si el banco no contesta un estado reconocible: quien llama no debe
   * confundir «no sé» con «sigue pendiente».
   */
  async statusQR(qrId: string): Promise<StatusQrResult> {
    const raw = await this.authenticatedRequest<
      BanecoEnvelope & { statusQrCode?: number; statusQRCode?: number; payment?: unknown }
    >('GET', `/api/qrsimple/v2/statusQR/${encodeURIComponent(qrId)}`);
    if (raw.responseCode !== 0) {
      throw new Error(`statusQR falló: responseCode=${raw.responseCode} message=${raw.message}`);
    }
    // El manual lo escribe `statusQRCode` en la tabla y `statusQrCode` en el ejemplo.
    const code = raw.statusQrCode ?? raw.statusQRCode;
    if (code !== 0 && code !== 1 && code !== 9) {
      throw new Error(`statusQR devolvió un estado desconocido: ${JSON.stringify(code)}`);
    }
    return { statusQrCode: code, payment: readPayment(raw.payment), raw };
  }

  /**
   * Anula el QR en el banco. Lanza si el banco no lo anuló — por ejemplo,
   * porque ya está pagado: un QR de un solo uso pagado no se puede anular.
   */
  async cancelQR(qrId: string): Promise<void> {
    const raw = await this.authenticatedRequest<BanecoEnvelope>(
      'DELETE',
      '/api/qrsimple/cancelQR',
      { qrId },
    );
    if (raw.responseCode !== 0) {
      throw new Error(`cancelQR falló: responseCode=${raw.responseCode} message=${raw.message}`);
    }
  }

  private settings() {
    const missing = this.missingSettings();
    if (missing.length > 0) {
      throw new Error(
        `El cobro por QR del banco no está configurado: falta ${missing.join(', ')}.`,
      );
    }
    return this.config.get('baneco', { infer: true });
  }

  private async getEncryptedAccount(): Promise<string> {
    if (this.cachedEncryptedAccount) return this.cachedEncryptedAccount;
    const { aesKey, account } = this.settings();
    this.cachedEncryptedAccount = await this.encrypt(account, aesKey);
    return this.cachedEncryptedAccount;
  }

  private async encrypt(text: string, aesKey: string): Promise<string> {
    const { baseUrl } = this.settings();
    const url = new URL(`${baseUrl}/api/authentication/encrypt`);
    url.searchParams.set('text', text);
    url.searchParams.set('aesKey', aesKey);
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Baneco /encrypt falló: HTTP ${response.status}`);
    }
    // El banco contesta el texto cifrado, con o sin comillas de JSON.
    const body = (await response.text()).trim();
    const encrypted = body.startsWith('"') ? (JSON.parse(body) as string) : body;
    if (!encrypted) throw new Error('Baneco /encrypt devolvió una respuesta vacía.');
    return encrypted;
  }

  private async authenticate(): Promise<string> {
    const { baseUrl, username, password, aesKey } = this.settings();
    const encryptedPassword = await this.encrypt(password, aesKey);
    const response = await fetch(`${baseUrl}/api/authentication/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: username, password: encryptedPassword }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Baneco /authenticate falló: HTTP ${response.status}`);
    }
    const body = (await response.json()) as BanecoEnvelope & { token?: string };
    if (body.responseCode !== 0 || !body.token) {
      throw new Error(`Baneco /authenticate rechazado: ${body.message}`);
    }
    this.cachedToken = { value: body.token, expiresAtMs: tokenExpiryMs(body.token) };
    return body.token;
  }

  private async currentToken(): Promise<string> {
    const cached = this.cachedToken;
    const stillValid =
      cached !== null &&
      (cached.expiresAtMs === null || cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > Date.now());
    return stillValid ? cached.value : this.authenticate();
  }

  /** `body` solo viaja en POST y DELETE: un GET lleva sus datos en la ruta. */
  private async authenticatedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { baseUrl } = this.settings();
    const token = await this.currentToken();

    const doRequest = async (bearer: string) =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearer}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    let response = await doRequest(token);
    if (response.status === 401) {
      this.logger.warn(`Baneco ${method} ${path} -> 401, reautenticando`);
      const freshToken = await this.authenticate();
      response = await doRequest(freshToken);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`Baneco ${method} ${path} -> ${response.status} ${text}`);
      throw new Error(`Baneco ${method} ${path} -> HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

/** Cuándo vence un JWT, según su campo `exp`. `null` si no se puede leer. */
function tokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** El manual declara `payment` como un objeto y lo muestra como una lista de uno. */
function readPayment(candidate: unknown): BanecoPayment | null {
  const first: unknown = Array.isArray(candidate) ? candidate[0] : candidate;
  return typeof first === 'object' && first !== null ? (first as BanecoPayment) : null;
}
