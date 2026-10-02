import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PaymentProofAnalysisContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
