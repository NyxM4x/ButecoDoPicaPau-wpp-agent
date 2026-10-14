import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/types';
import { UpdateOperationalSettingsDto } from './dto/update-operational-settings.dto';
import { RestaurantProfileResponse, toRestaurantProfile } from './restaurant-profile';

export interface OperationalSettingsResponse {
  rainSurchargeEnabled: boolean;
  rainSurchargeAmount: number;
  /** Margen ancho de cordura, no el horario preciso — ver comentario en OperationalSettingsTable. */
  businessOpensHour: number;
  businessClosesHour: number;
  restaurantLatitude: number | null;
  restaurantLongitude: number | null;
  ordersPaused: boolean;
  pickupEnabled: boolean;
  restaurantName: string;
  /** `false` = modo «sin POS»: sin caja, con el pedido completo al personal por Telegram. */
  requiresCashRegister: boolean;
  autoCompleteMinutes: number | null;
}

/**
 * Horario de atención + recargo por lluvia + coordenadas del restaurante —
 * fila única (id = true). El gate de horario (invariante 7), la medición de
 * distancia de delivery y la cotización (que congela el recargo en la misma
 * transacción) leen de aquí.
 */
@Injectable()
export class OperationalSettingsService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async get(): Promise<OperationalSettingsResponse> {
    const row = await this.getRow();
    return toResponse(row);
  }

  /** `GET /restaurant/profile`: el perfil que el agente dice del local. */
  async getProfile(): Promise<RestaurantProfileResponse> {
    return toRestaurantProfile(await this.getRow());
  }

  /** Fila cruda tal como está en BD — para consumo interno de otros módulos (delivery, orders). */
  async getRow() {
    return this.db
      .selectFrom('operational_settings')
      .selectAll()
      .where('id', '=', true)
      .executeTakeFirstOrThrow();
  }

  async update(dto: UpdateOperationalSettingsDto): Promise<OperationalSettingsResponse> {
    const row = await this.db
      .updateTable('operational_settings')
      .set({
        ...(dto.rainSurchargeEnabled !== undefined
          ? { rain_surcharge_enabled: dto.rainSurchargeEnabled }
          : {}),
        ...(dto.rainSurchargeAmount !== undefined
          ? { rain_surcharge_amount: dto.rainSurchargeAmount.toFixed(2) }
          : {}),
        ...(dto.businessOpensHour !== undefined
          ? { business_opens_hour: dto.businessOpensHour }
          : {}),
        ...(dto.businessClosesHour !== undefined
          ? { business_closes_hour: dto.businessClosesHour }
          : {}),
        ...(dto.restaurantLatitude !== undefined
          ? { restaurant_latitude: dto.restaurantLatitude }
          : {}),
        ...(dto.restaurantLongitude !== undefined
          ? { restaurant_longitude: dto.restaurantLongitude }
          : {}),
        ...(dto.ordersPaused !== undefined ? { orders_paused: dto.ordersPaused } : {}),
        ...(dto.pickupEnabled !== undefined ? { pickup_enabled: dto.pickupEnabled } : {}),
        ...(dto.restaurantName !== undefined ? { restaurant_name: dto.restaurantName.trim() } : {}),
        ...(typeof dto.requiresCashRegister === 'boolean'
          ? { requires_cash_register: dto.requiresCashRegister }
          : {}),
        ...(dto.autoCompleteMinutes !== undefined
          ? { auto_complete_minutes: dto.autoCompleteMinutes }
          : {}),
        ...profileUpdate(dto),
        updated_at: new Date(),
      })
      .where('id', '=', true)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toResponse(row);
  }
}

/** Texto opcional: vacío o `null` borra el dato; `undefined` no lo toca. */
function nullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

/**
 * Los campos del perfil del restaurante que vienen en el PATCH.
 *
 * Los opcionales aceptan `null` para borrarse. Los obligatorios (zona horaria,
 * idioma, moneda) ignoran un `null`: la columna no lo admite y un PATCH no
 * debe poder dejar al agente sin moneda.
 */
function profileUpdate(dto: UpdateOperationalSettingsDto) {
  const optional = {
    restaurant_description: nullableText(dto.restaurantDescription),
    restaurant_phone: nullableText(dto.restaurantPhone),
    restaurant_address: nullableText(dto.restaurantAddress),
    restaurant_maps_url: nullableText(dto.restaurantMapsUrl),
    hours_text: nullableText(dto.hoursText),
    greeting_message: nullableText(dto.greetingMessage),
    farewell_message: nullableText(dto.farewellMessage),
    menu_video_url: nullableText(dto.menuVideoUrl),
    menu_image_url: nullableText(dto.menuImageUrl),
  };
  return {
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    ...(dto.restaurantTimezone ? { restaurant_timezone: dto.restaurantTimezone } : {}),
    ...(dto.restaurantLocale ? { restaurant_locale: dto.restaurantLocale } : {}),
    ...(dto.currencyCode ? { currency_code: dto.currencyCode.toUpperCase() } : {}),
    ...(dto.currencySymbol?.trim() ? { currency_symbol: dto.currencySymbol.trim() } : {}),
    ...(typeof dto.deliveryEnabled === 'boolean' ? { delivery_enabled: dto.deliveryEnabled } : {}),
    ...(dto.enabledPaymentMethods
      ? { enabled_payment_methods: [...new Set(dto.enabledPaymentMethods)] }
      : {}),
  };
}

function toResponse(row: {
  rain_surcharge_enabled: boolean;
  rain_surcharge_amount: string;
  business_opens_hour: number;
  business_closes_hour: number;
  restaurant_latitude: number | null;
  restaurant_longitude: number | null;
  orders_paused: boolean;
  pickup_enabled: boolean;
  restaurant_name: string;
  requires_cash_register: boolean;
  auto_complete_minutes: number | null;
}): OperationalSettingsResponse {
  return {
    rainSurchargeEnabled: row.rain_surcharge_enabled,
    rainSurchargeAmount: Number(row.rain_surcharge_amount),
    businessOpensHour: row.business_opens_hour,
    businessClosesHour: row.business_closes_hour,
    restaurantLatitude: row.restaurant_latitude,
    restaurantLongitude: row.restaurant_longitude,
    ordersPaused: row.orders_paused,
    pickupEnabled: row.pickup_enabled,
    restaurantName: row.restaurant_name,
    requiresCashRegister: row.requires_cash_register,
    autoCompleteMinutes: row.auto_complete_minutes,
  };
}
