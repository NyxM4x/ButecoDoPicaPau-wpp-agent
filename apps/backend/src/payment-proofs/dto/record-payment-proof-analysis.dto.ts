import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const PAYMENT_PROOF_ANALYSIS_VERDICTS = ['ok', 'suspicious', 'unreadable'] as const;
export type PaymentProofAnalysisVerdictDto = (typeof PAYMENT_PROOF_ANALYSIS_VERDICTS)[number];

export const PAYMENT_PROOF_ANALYSIS_REASONS = [
  'account_mismatch',
  'holder_mismatch',
  'bank_mismatch',
  'reference_reused',
  'stale_receipt',
  'not_a_receipt',
  'unreadable',
  'amount_mismatch',
] as const;
export type PaymentProofAnalysisReasonDto = (typeof PAYMENT_PROOF_ANALYSIS_REASONS)[number];

export const PAYMENT_PROOF_AMOUNT_LABELS = [
  'pago_total',
  'pago_productos',
  'revisar_monto',
] as const;
export type PaymentProofAmountLabelDto = (typeof PAYMENT_PROOF_AMOUNT_LABELS)[number];

export class RecordPaymentProofAnalysisDto {
  @IsIn(['ok', 'failed'])
  status!: 'ok' | 'failed';

  @ValidateIf((value: RecordPaymentProofAnalysisDto) => value.status === 'ok')
  @IsIn(PAYMENT_PROOF_ANALYSIS_VERDICTS)
  verdict?: PaymentProofAnalysisVerdictDto;

  @ValidateIf((value: RecordPaymentProofAnalysisDto) => value.status === 'ok')
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(PAYMENT_PROOF_ANALYSIS_REASONS, { each: true })
  reasons?: PaymentProofAnalysisReasonDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number | null;

  @IsOptional()
  @IsIn(PAYMENT_PROOF_AMOUNT_LABELS)
  amountLabel?: PaymentProofAmountLabelDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinationAccount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinationHolder?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinationBank?: string | null;
}
