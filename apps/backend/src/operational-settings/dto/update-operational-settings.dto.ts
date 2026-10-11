import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
}
