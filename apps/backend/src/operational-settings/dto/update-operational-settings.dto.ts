import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO4217CurrencyCode,
  IsLatitude,
  IsLocale,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OrderPaymentMethod } from '../../database/types';

const PAYMENT_METHODS: OrderPaymentMethod[] = ['cash', 'qr', 'card'];
/** Las URL que el agente le manda a WhatsApp tienen que ser públicas y con https. */
const PUBLIC_URL = { protocols: ['https'], require_protocol: true };

export class UpdateOperationalSettingsDto {
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  ordersPaused?: boolean;

  @IsOptional()
  @IsBoolean()
  rainSurchargeEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rainSurchargeAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  businessOpensHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  businessClosesHour?: number;

  @IsOptional()
  @IsLatitude()
  restaurantLatitude?: number;

  @IsOptional()
  @IsLongitude()
  restaurantLongitude?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  restaurantName?: string;

  // ── Modo «sin POS» ────────────────────────────────────────────────────────

  /** `false` = no se exige caja abierta: el horario decide si se toma un pedido. */
  @IsOptional()
  @IsBoolean()
  requiresCashRegister?: boolean;

  /** Minutos para cerrar solo un pedido firme. `null` = no cerrarlo. */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1440)
  autoCompleteMinutes?: number | null;

  // ── Perfil del restaurante (`GET /restaurant/profile`) ────────────────────
  // Los textos opcionales aceptan `null` para borrarse.

  @IsOptional()
  @IsString()
  @MaxLength(200)
  restaurantDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  restaurantPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  restaurantAddress?: string | null;

  @IsOptional()
  @IsUrl(PUBLIC_URL)
  @MaxLength(300)
  restaurantMapsUrl?: string | null;

  @IsOptional()
  @IsTimeZone()
  restaurantTimezone?: string;

  @IsOptional()
  @IsLocale()
  restaurantLocale?: string;

  @IsOptional()
  @IsISO4217CurrencyCode()
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  currencySymbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hoursText?: string | null;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PAYMENT_METHODS, { each: true })
  enabledPaymentMethods?: OrderPaymentMethod[];

  @IsOptional()
  @IsString()
  @MaxLength(600)
  greetingMessage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  farewellMessage?: string | null;

  @IsOptional()
  @IsUrl(PUBLIC_URL)
  @MaxLength(300)
  menuVideoUrl?: string | null;

  @IsOptional()
  @IsUrl(PUBLIC_URL)
  @MaxLength(300)
  menuImageUrl?: string | null;
}
