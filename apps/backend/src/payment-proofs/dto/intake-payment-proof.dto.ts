import { IsISO8601, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class IntakePaymentProofDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @MinLength(1)
  sourceMessageId!: string;

  /** WAMID del mensaje al que el cliente respondió, si respondió a uno. */
  @IsOptional()
  @IsString()
  contextMessageId?: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  /**
   * Bytes del archivo, ya descargados por el gateway de WhatsApp — nunca una URL.
   * Puede faltar si el canal recibió media que no pudo descargar/interpretar:
   * en ese caso se conserva una fila failed para revisión, si había un pedido
   * QR candidato.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  fileBase64?: string;

  /** Instante en que el proveedor recibió el mensaje (tiempo de EVENTO, no el reloj del proceso). */
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
}
