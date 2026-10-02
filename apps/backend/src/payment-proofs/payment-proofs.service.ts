import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import {
  Database,
  PaymentProofAmountLabel,
  PaymentProofAnalysisReason,
  PaymentProofAnalysisStatus,
  PaymentProofAnalysisVerdict,
  PaymentProofMatchMethod,
  PaymentProofRoutingException,
} from '../database/types';
import {
  DomainException,
  NotFoundDomainError,
  ValidationError,
} from '../common/exceptions/domain-exception';
import { OrderCandidate, resolveAssociation } from './association';
import {
  buildPaymentProofKey,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_STORAGE,
  PaymentProofStorage,
} from './storage/payment-proof-storage';
import { IntakePaymentProofDto } from './dto/intake-payment-proof.dto';
import { RecordPaymentProofAnalysisDto } from './dto/record-payment-proof-analysis.dto';

const STORAGE_NAMESPACE = 'payment-proofs';

export interface PaymentProofResponse {
  id: string;
  orderId: string | null;
  customerId: string | null;
  attemptId: string | null;
  matchMethod: string;
  routingException: string | null;
  captureStatus: string;
  candidateCount: number | null;
  analysisStatus: PaymentProofAnalysisStatus;
  analysisVerdict: PaymentProofAnalysisVerdict | null;
  analysisReasons: PaymentProofAnalysisReason[] | null;
  analysisAmount: number | null;
  analysisAmountLabel: PaymentProofAmountLabel | null;
  analysisReference: string | null;
  analysisModel: string | null;
  analysisDestinationAccount: string | null;
  analysisDestinationHolder: string | null;
  analysisDestinationBank: string | null;
  analyzedAt: string | null;
  createdAt: string;
}

type PaymentProofRow = {
  id: string;
  order_id: string | null;
  customer_id: string | null;
  attempt_id: string | null;
  match_method: string;
  routing_exception: string | null;
  capture_status: string;
  candidate_count: number | null;
  analysis_status: PaymentProofAnalysisStatus;
  analysis_verdict: PaymentProofAnalysisVerdict | null;
  analysis_reasons: PaymentProofAnalysisReason[] | null;
  analysis_amount: string | null;
  analysis_amount_label: PaymentProofAmountLabel | null;
  analysis_reference: string | null;
  analysis_model: string | null;
  analysis_destination_account: string | null;
  analysis_destination_holder: string | null;
  analysis_destination_bank: string | null;
  analyzed_at: Date | string | null;
  created_at: Date | string;
};

/**
 * Portado de `route_and_claim_payment_proof` (saas_smarky,
 * `0022_payment_attempt_rpcs.sql`) — mismo reparto de autoridad: la
 * asociación (identidad) la decide `resolveAssociation` (puro, fuera del
 * lock); la viveza (¿hay episodio abierto?) se decide aquí, bajo
 * `pg_advisory_xact_lock` por `customer_id` y con SAVEPOINTs replicando las
 * subtransacciones PL/pgSQL que evitan dejar un `payment_attempt` huérfano.
 *
 * A diferencia del proyecto viejo, el archivo llega YA DESCARGADO en el
 * body (el gateway de WhatsApp lo descarga) — no hay paso async de
 * descarga, así que no hace falta el mecanismo de lease/reclaim por
 * captura lenta: se va directo de 'capturing' a 'stored' o 'failed'.
 */
@Injectable()
export class PaymentProofsService {
  private readonly logger = new Logger(PaymentProofsService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(PAYMENT_PROOF_STORAGE) private readonly storage: PaymentProofStorage,
  ) {}

  async findWithRoutingException(
    exception?: PaymentProofRoutingException,
  ): Promise<PaymentProofResponse[]> {
    let query = this.db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('routing_exception', 'is not', null);
    if (exception) query = query.where('routing_exception', '=', exception);
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(toResponse);
  }

  async findUnassigned(matchMethod?: string): Promise<PaymentProofResponse[]> {
    let query = this.db.selectFrom('payment_proofs').selectAll().where('order_id', 'is', null);
    if (matchMethod)
      query = query.where('match_method', '=', matchMethod as PaymentProofMatchMethod);
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(toResponse);
  }

  async analysisContext(
    id: string,
    reference?: string,
  ): Promise<{
    orderId: string | null;
    expectedAmounts: { subtotal: number; total: number } | null;
    referenceUsedElsewhere: boolean;
  }> {
    const proof = await this.db
      .selectFrom('payment_proofs')
      .select(['id', 'order_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!proof) throw new NotFoundDomainError('payment_proof', id);

    let expectedAmounts: { subtotal: number; total: number } | null = null;
    if (proof.order_id) {
      const order = await this.db
        .selectFrom('orders')
        .select(['subtotal_amount', 'total_amount'])
        .where('id', '=', proof.order_id)
        .executeTakeFirst();
      if (order) {
        const subtotal = Number(order.subtotal_amount);
        const total = Number(order.total_amount);
        if (Number.isFinite(subtotal) && Number.isFinite(total)) {
          expectedAmounts = { subtotal, total };
        }
      }
    }

    let referenceUsedElsewhere = false;
    const normalizedReference = reference?.trim();
    if (normalizedReference) {
      const rows = await this.db
        .selectFrom('payment_proofs')
        .select(['id', 'order_id'])
        .where('analysis_reference', '=', normalizedReference)
        .where('id', '!=', id)
        .limit(20)
        .execute();
      referenceUsedElsewhere = rows.some((row) => row.order_id !== proof.order_id);
    }

    return {
      orderId: proof.order_id,
      expectedAmounts,
      referenceUsedElsewhere,
    };
  }

  async recordAnalysis(
    id: string,
    dto: RecordPaymentProofAnalysisDto,
  ): Promise<PaymentProofResponse> {
    const existing = await this.db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) throw new NotFoundDomainError('payment_proof', id);
    if (existing.capture_status !== 'stored') {
      throw new DomainException(
        'payment_proof_not_stored',
        HttpStatus.CONFLICT,
        'El comprobante debe estar almacenado antes de registrar su análisis.',
      );
    }

    if (dto.status === 'failed') {
      const hasResultData =
        dto.verdict !== undefined ||
        dto.reasons !== undefined ||
        dto.amount !== undefined ||
        dto.amountLabel !== undefined ||
        dto.reference !== undefined ||
        dto.model !== undefined ||
        dto.destinationAccount !== undefined ||
        dto.destinationHolder !== undefined ||
        dto.destinationBank !== undefined;

      if (hasResultData) {
        throw new ValidationError(
          'Un análisis fallido no puede incluir veredicto ni datos de lectura.',
        );
      }
      if (existing.analysis_status === 'ok') {
        throw new DomainException(
          'payment_proof_analysis_already_recorded',
          HttpStatus.CONFLICT,
          'El comprobante ya tiene un análisis exitoso y no puede degradarse a failed.',
        );
      }
      if (existing.analysis_status === 'failed') return toResponse(existing);

      const failed = await this.db
        .updateTable('payment_proofs')
        .set({
          analysis_status: 'failed',
          analysis_verdict: null,
          analysis_reasons: null,
          analysis_amount: null,
          analysis_amount_label: null,
          analysis_reference: null,
          analysis_model: null,
          analysis_destination_account: null,
          analysis_destination_holder: null,
          analysis_destination_bank: null,
          analyzed_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('analysis_status', '=', 'pending')
        .returningAll()
        .executeTakeFirst();

      if (failed) return toResponse(failed);
      return this.recordAnalysis(id, dto);
    }

    if (!dto.verdict || !dto.reasons) {
      throw new ValidationError('Un análisis exitoso requiere verdict y reasons.');
    }

    const normalized = {
      verdict: dto.verdict,
      reasons: dto.reasons,
      amount: dto.amount ?? null,
      amountLabel: dto.amountLabel ?? null,
      reference: normalizeAnalysisText(dto.reference),
      model: normalizeAnalysisText(dto.model),
      destinationAccount: normalizeAnalysisText(dto.destinationAccount),
      destinationHolder: normalizeAnalysisText(dto.destinationHolder),
      destinationBank: normalizeAnalysisText(dto.destinationBank),
    };

    if (existing.analysis_status === 'ok') {
      if (sameAnalysis(existing, normalized)) return toResponse(existing);
      throw new DomainException(
        'payment_proof_analysis_already_recorded',
        HttpStatus.CONFLICT,
        'El comprobante ya tiene un análisis exitoso distinto.',
      );
    }

    const updated = await this.db
      .updateTable('payment_proofs')
      .set({
        analysis_status: 'ok',
        analysis_verdict: normalized.verdict,
        analysis_reasons: normalized.reasons,
        analysis_amount: normalized.amount === null ? null : normalized.amount.toFixed(2),
        analysis_amount_label: normalized.amountLabel,
        analysis_reference: normalized.reference,
        analysis_model: normalized.model,
        analysis_destination_account: normalized.destinationAccount,
        analysis_destination_holder: normalized.destinationHolder,
        analysis_destination_bank: normalized.destinationBank,
        analyzed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('analysis_status', 'in', ['pending', 'failed'])
      .returningAll()
      .executeTakeFirst();

    if (updated) return toResponse(updated);
    return this.recordAnalysis(id, dto);
  }

  async assign(id: string, orderId: string): Promise<PaymentProofResponse> {
    const row = await this.db
      .updateTable('payment_proofs')
      .set({ order_id: orderId, match_method: 'manual', updated_at: new Date() })
      .where('id', '=', id)
      .where('order_id', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      const existing = await this.db
        .selectFrom('payment_proofs')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!existing) throw new NotFoundDomainError('payment_proof', id);
      throw new DomainException(
        'payment_proof_already_assigned',
        HttpStatus.CONFLICT,
        'El comprobante ya tiene un pedido asignado.',
      );
    }
    return toResponse(row);
  }

  /**
   * POST /payment-proofs. Idempotencia real por `source_message_id`
   * (UNIQUE en BD — esa es la barrera, el pre-chequeo es solo optimización).
   */
  async intake(dto: IntakePaymentProofDto): Promise<PaymentProofResponse> {
    const existing = await this.db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('source_message_id', '=', dto.sourceMessageId)
      .executeTakeFirst();
    if (existing) return toResponse(existing);

    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    const bytes = dto.fileBase64 ? Buffer.from(dto.fileBase64, 'base64') : null;
    if (bytes && (bytes.length === 0 || bytes.length > PAYMENT_PROOF_MAX_BYTES)) {
      throw new ValidationError(
        `El archivo debe pesar entre 1 byte y ${PAYMENT_PROOF_MAX_BYTES} bytes.`,
      );
    }
    const sha256Hex = bytes ? createHash('sha256').update(bytes).digest('hex') : null;

    const orders = await this.loadOrderCandidates(dto.customerId);
    const priorSameFile = sha256Hex
      ? await this.db
          .selectFrom('payment_proofs')
          .select(['id as proof_id', 'attempt_id', 'order_id'])
          .where('customer_id', '=', dto.customerId)
          .where('sha256_hex', '=', sha256Hex)
          .execute()
      : [];

    const association = resolveAssociation({
      contextMessageId: dto.contextMessageId ?? null,
      receivedAt,
      orders,
      priorSameFile: priorSameFile.map((p) => ({
        proofId: p.proof_id,
        attemptId: p.attempt_id,
        orderId: p.order_id,
      })),
    });

    if (association.match === 'no_match') {
      throw new DomainException(
        'payment_proof_no_match',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No se encontró ningún pedido QR reciente de este cliente; el comprobante no se guarda.',
      );
    }

    const claim = await this.routeAndClaim(
      dto,
      association,
      receivedAt,
      sha256Hex,
      bytes?.length ?? null,
    );
    if (claim.alreadyClaimed) return toResponse(claim.row);

    if (!bytes) {
      const failed = await this.db
        .updateTable('payment_proofs')
        .set({ capture_status: 'failed', updated_at: new Date() })
        .where('id', '=', claim.row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toResponse(failed);
    }

    return this.storeAndFinalize(claim.row, dto.mimeType, bytes);
  }

  private async loadOrderCandidates(customerId: string): Promise<OrderCandidate[]> {
    // El join necesita comparar o.id (uuid) contra notification_jobs.target_ref
    // (text) con cast explícito — más simple en SQL crudo que en el builder.
    const result = await sql<{
      order_id: string;
      status: string;
      confirmation_external_message_id: string | null;
      confirmation_sent_at: Date | null;
    }>`
      select o.id as order_id, o.status as status,
        nj.external_message_id as confirmation_external_message_id,
        nj.updated_at as confirmation_sent_at
      from orders o
      left join notification_jobs nj
        on nj.target_ref = o.id::text
       and nj.kind = 'qr_confirmation'
       and nj.channel = 'whatsapp'
       and nj.status = 'sent'
      where o.customer_id = ${customerId}
        and o.payment_method = 'qr'
    `.execute(this.db);

    const rows = result.rows;
    if (rows.length === 0) return [];

    const acceptedRows = await this.db
      .selectFrom('payment_attempts')
      .select('order_id')
      .where(
        'order_id',
        'in',
        rows.map((r) => r.order_id),
      )
      .where('review_status', '=', 'accepted')
      .execute();
    const acceptedOrderIds = new Set(acceptedRows.map((r) => r.order_id));

    return rows.map((r) => ({
      orderId: r.order_id,
      status: r.status,
      hasAcceptedProof: acceptedOrderIds.has(r.order_id),
      confirmationExternalMessageId: r.confirmation_external_message_id,
      confirmationSentAt: r.confirmation_sent_at ? new Date(r.confirmation_sent_at) : null,
    }));
  }

  /**
   * Bajo `pg_advisory_xact_lock(hashtext(customer_id))` — serializa TODO el
   * routing de un mismo cliente. Dos SAVEPOINTs anidados replican las
   * subtransacciones PL/pgSQL del original: el interno solo cubre el
   * INSERT en payment_attempts (si choca con el índice vivo, se relee y se
   * une); el externo cubre TODO el bloque + el INSERT en payment_proofs (si
   * choca con el UNIQUE de source_message_id, deshace también el intento
   * recién creado — el "problema de los intentos huérfanos").
   */
  private async routeAndClaim(
    dto: IntakePaymentProofDto,
    association: ReturnType<typeof resolveAssociation>,
    receivedAt: Date,
    sha256Hex: string | null,
    byteSize: number | null,
  ): Promise<{ alreadyClaimed: boolean; row: PaymentProofRow }> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${dto.customerId}))`.execute(trx);

      const raced = await trx
        .selectFrom('payment_proofs')
        .selectAll()
        .where('source_message_id', '=', dto.sourceMessageId)
        .executeTakeFirst();
      if (raced) return { alreadyClaimed: true, row: raced };

      let matchMethod: PaymentProofMatchMethod = association.match as PaymentProofMatchMethod;
      let routingException = association.routingException;
      let attemptId: string | null = null;
      const orderId = association.orderId;

      await sql`savepoint sp_outer`.execute(trx);
      try {
        if (orderId !== null && routingException === null) {
          if (association.duplicateOfProofId !== null) {
            const original = await trx
              .selectFrom('payment_proofs')
              .select('attempt_id')
              .where('id', '=', association.duplicateOfProofId)
              .executeTakeFirst();
            if (!original || original.attempt_id === null) {
              throw new Error(
                `route_and_claim: el original ${association.duplicateOfProofId} no tiene episodio; no se puede heredar.`,
              );
            }
            attemptId = original.attempt_id;
          } else {
            const live = await trx
              .selectFrom('payment_attempts')
              .select(['id', 'review_status'])
              .where('order_id', '=', orderId)
              .where('review_status', 'in', ['pending_review', 'accepted'])
              .forUpdate()
              .executeTakeFirst();

            if (live && live.review_status === 'accepted') {
              routingException = 'payment_already_accepted';
            } else if (live) {
              attemptId = live.id;
              matchMethod = 'attached';
            } else {
              await sql`savepoint sp_attempt`.execute(trx);
              try {
                const inserted = await trx
                  .insertInto('payment_attempts')
                  .values({
                    order_id: orderId,
                    customer_id: dto.customerId,
                    opened_at: receivedAt,
                    opened_as: association.openedAs ?? 'normal',
                  })
                  .returning('id')
                  .executeTakeFirstOrThrow();
                attemptId = inserted.id;
                await sql`release savepoint sp_attempt`.execute(trx);
              } catch {
                await sql`rollback to savepoint sp_attempt`.execute(trx);
                const liveAfter = await trx
                  .selectFrom('payment_attempts')
                  .select(['id', 'review_status'])
                  .where('order_id', '=', orderId)
                  .where('review_status', 'in', ['pending_review', 'accepted'])
                  .executeTakeFirst();
                if (!liveAfter) {
                  throw new Error(
                    `route_and_claim: el índice vivo rechazó el intento del pedido ${orderId} pero no hay ninguno vivo que leer.`,
                  );
                }
                if (liveAfter.review_status === 'accepted') {
                  routingException = 'payment_already_accepted';
                } else {
                  attemptId = liveAfter.id;
                  matchMethod = 'attached';
                }
              }
            }
          }
        }

        if (routingException !== null) attemptId = null;

        const insertedProof = await trx
          .insertInto('payment_proofs')
          .values({
            source_message_id: dto.sourceMessageId,
            customer_id: dto.customerId,
            order_id: orderId,
            match_method: matchMethod,
            attempt_id: attemptId,
            duplicate_of_id: association.duplicateOfProofId,
            routing_exception: routingException,
            mime_type: dto.mimeType,
            byte_size: byteSize,
            sha256_hex: sha256Hex,
            capture_status: 'capturing',
            candidate_count: association.candidateCount,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await sql`release savepoint sp_outer`.execute(trx);
        return { alreadyClaimed: false, row: insertedProof };
      } catch (error) {
        await sql`rollback to savepoint sp_outer`.execute(trx);
        const winner = await trx
          .selectFrom('payment_proofs')
          .selectAll()
          .where('source_message_id', '=', dto.sourceMessageId)
          .executeTakeFirst();
        if (winner) return { alreadyClaimed: true, row: winner };
        throw error;
      }
    });
  }

  private async storeAndFinalize(
    proof: PaymentProofRow,
    mimeType: string,
    bytes: Buffer,
  ): Promise<PaymentProofResponse> {
    const keyResult = buildPaymentProofKey({
      namespace: STORAGE_NAMESPACE,
      proofId: proof.id,
      mimeType,
      createdAt: new Date(proof.created_at),
    });

    if ('error' in keyResult) {
      const failed = await this.db
        .updateTable('payment_proofs')
        .set({ capture_status: 'failed', updated_at: new Date() })
        .where('id', '=', proof.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toResponse(failed);
    }

    try {
      await this.storage.putObject({ key: keyResult.key, bytes, mimeType });
      const stored = await this.db
        .updateTable('payment_proofs')
        .set({
          capture_status: 'stored',
          storage_key: keyResult.key,
          updated_at: new Date(),
        })
        .where('id', '=', proof.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toResponse(stored);
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el archivo del proof ${proof.id}: ${(error as Error).message}`,
      );
      const failed = await this.db
        .updateTable('payment_proofs')
        .set({ capture_status: 'failed', updated_at: new Date() })
        .where('id', '=', proof.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toResponse(failed);
    }
  }

  async readFile(id: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const row = await this.db
      .selectFrom('payment_proofs')
      .select(['storage_key', 'mime_type', 'capture_status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundDomainError('payment_proof', id);
    if (row.capture_status !== 'stored' || !row.storage_key) {
      throw new DomainException(
        'payment_proof_not_stored',
        HttpStatus.CONFLICT,
        `El comprobante no está almacenado (capture_status=${row.capture_status}).`,
      );
    }
    const bytes = await this.storage.getObject(row.storage_key);
    return { bytes, mimeType: row.mime_type };
  }
}

function toResponse(row: PaymentProofRow): PaymentProofResponse {
  return {
    id: row.id,
    orderId: row.order_id,
    customerId: row.customer_id,
    attemptId: row.attempt_id,
    matchMethod: row.match_method,
    routingException: row.routing_exception,
    captureStatus: row.capture_status,
    candidateCount: row.candidate_count,
    analysisStatus: row.analysis_status,
    analysisVerdict: row.analysis_verdict,
    analysisReasons: row.analysis_reasons,
    analysisAmount: row.analysis_amount === null ? null : Number(row.analysis_amount),
    analysisAmountLabel: row.analysis_amount_label,
    analysisReference: row.analysis_reference,
    analysisModel: row.analysis_model,
    analysisDestinationAccount: row.analysis_destination_account,
    analysisDestinationHolder: row.analysis_destination_holder,
    analysisDestinationBank: row.analysis_destination_bank,
    analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function normalizeAnalysisText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function sameAnalysis(
  row: PaymentProofRow,
  value: {
    verdict: PaymentProofAnalysisVerdict;
    reasons: PaymentProofAnalysisReason[];
    amount: number | null;
    amountLabel: PaymentProofAmountLabel | null;
    reference: string | null;
    model: string | null;
    destinationAccount: string | null;
    destinationHolder: string | null;
    destinationBank: string | null;
  },
): boolean {
  return (
    row.analysis_verdict === value.verdict &&
    JSON.stringify(row.analysis_reasons ?? []) === JSON.stringify(value.reasons) &&
    (row.analysis_amount === null ? null : Number(row.analysis_amount)) === value.amount &&
    row.analysis_amount_label === value.amountLabel &&
    row.analysis_reference === value.reference &&
    row.analysis_model === value.model &&
    row.analysis_destination_account === value.destinationAccount &&
    row.analysis_destination_holder === value.destinationHolder &&
    row.analysis_destination_bank === value.destinationBank
  );
}
