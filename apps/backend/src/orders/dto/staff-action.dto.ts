import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StaffActionDto {
  /** Quién tocó el botón (su nombre en Telegram). Solo queda como registro. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  actor?: string;
}
