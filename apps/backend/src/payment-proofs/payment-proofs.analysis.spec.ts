import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { PaymentProofsService } from './payment-proofs.service';

function proofRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    order_id: '22222222-2222-4222-8222-222222222222',
    customer_id: '33333333-3333-4333-8333-333333333333',
    attempt_id: '44444444-4444-4444-8444-444444444444',
    match_method: 'attached',
    routing_exception: null,
    capture_status: 'stored',
    candidate_count: 1,
    analysis_status: 'pending',
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
    created_at: new Date('2026-09-19T01:00:00.000Z'),
    ...overrides,
  };
}

function makeDb(existing: ReturnType<typeof proofRow>, updated?: ReturnType<typeof proofRow>) {
  const selectBuilder: Record<string, unknown> = {};
  selectBuilder.selectAll = jest.fn(() => selectBuilder);
  selectBuilder.where = jest.fn(() => selectBuilder);
  selectBuilder.executeTakeFirst = jest.fn().mockResolvedValue(existing);

  const updateBuilder: Record<string, unknown> = {};
  updateBuilder.set = jest.fn(() => updateBuilder);
  updateBuilder.where = jest.fn(() => updateBuilder);
  updateBuilder.returningAll = jest.fn(() => updateBuilder);
  updateBuilder.executeTakeFirst = jest.fn().mockResolvedValue(updated);

  return {
    db: {
      selectFrom: jest.fn(() => selectBuilder),
      updateTable: jest.fn(() => updateBuilder),
    } as unknown as Kysely<Database>,
    set: updateBuilder.set as jest.Mock,
  };
}

describe('PaymentProofsService.recordAnalysis', () => {
  it('stores an auditable successful analysis without deciding the payment', async () => {
    const existing = proofRow();
    const updated = proofRow({
      analysis_status: 'ok',
      analysis_verdict: 'suspicious',
      analysis_reasons: ['account_mismatch'],
      analysis_amount: '48.00',
      analysis_amount_label: 'pago_total',
      analysis_reference: 'TX-123',
      analysis_model: 'gpt-5-mini',
      analysis_destination_account: '4477',
      analysis_destination_holder: 'OTRO TITULAR',
      analysis_destination_bank: 'BCP',
      analyzed_at: new Date('2026-09-19T01:05:00.000Z'),
    });
    const { db, set } = makeDb(existing, updated);
    const service = new PaymentProofsService(db, {} as never);

    const result = await service.recordAnalysis(existing.id, {
      status: 'ok',
      verdict: 'suspicious',
      reasons: ['account_mismatch'],
      amount: 48,
      amountLabel: 'pago_total',
      reference: ' TX-123 ',
      model: 'gpt-5-mini',
      destinationAccount: '4477',
      destinationHolder: 'OTRO TITULAR',
      destinationBank: 'BCP',
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'ok',
        analysis_verdict: 'suspicious',
        analysis_reasons: ['account_mismatch'],
        analysis_amount: '48.00',
        analysis_reference: 'TX-123',
      }),
    );
    expect(result).toMatchObject({
      analysisStatus: 'ok',
      analysisVerdict: 'suspicious',
      analysisAmount: 48,
      analysisReference: 'TX-123',
    });
  });

  it('is idempotent when the same successful analysis is retried', async () => {
    const existing = proofRow({
      analysis_status: 'ok',
      analysis_verdict: 'ok',
      analysis_reasons: [],
      analysis_amount: '50.00',
      analysis_amount_label: 'pago_productos',
      analysis_reference: 'TX-OK',
      analysis_model: 'gpt-5-mini',
      analyzed_at: new Date('2026-09-19T01:05:00.000Z'),
    });
    const selectBuilder: Record<string, unknown> = {};
    selectBuilder.selectAll = jest.fn(() => selectBuilder);
    selectBuilder.where = jest.fn(() => selectBuilder);
    selectBuilder.executeTakeFirst = jest.fn().mockResolvedValue(existing);
    const updateTable = jest.fn();
    const db = {
      selectFrom: jest.fn(() => selectBuilder),
      updateTable,
    } as unknown as Kysely<Database>;
    const service = new PaymentProofsService(db, {} as never);

    await expect(
      service.recordAnalysis(existing.id, {
        status: 'ok',
        verdict: 'ok',
        reasons: [],
        amount: 50,
        amountLabel: 'pago_productos',
        reference: 'TX-OK',
        model: 'gpt-5-mini',
      }),
    ).resolves.toMatchObject({ analysisStatus: 'ok', analysisVerdict: 'ok' });

    expect(updateTable).not.toHaveBeenCalled();
  });

  it('does not allow a successful result to be overwritten by a different one', async () => {
    const existing = proofRow({
      analysis_status: 'ok',
      analysis_verdict: 'ok',
      analysis_reasons: [],
      analyzed_at: new Date('2026-09-19T01:05:00.000Z'),
    });
    const selectBuilder: Record<string, unknown> = {};
    selectBuilder.selectAll = jest.fn(() => selectBuilder);
    selectBuilder.where = jest.fn(() => selectBuilder);
    selectBuilder.executeTakeFirst = jest.fn().mockResolvedValue(existing);
    const service = new PaymentProofsService(
      { selectFrom: jest.fn(() => selectBuilder) } as unknown as Kysely<Database>,
      {} as never,
    );

    await expect(
      service.recordAnalysis(existing.id, {
        status: 'ok',
        verdict: 'suspicious',
        reasons: ['bank_mismatch'],
      }),
    ).rejects.toMatchObject({ code: 'payment_proof_analysis_already_recorded' });
  });

  it('allows a failed analysis to be retried later but stores failure without a verdict', async () => {
    const existing = proofRow();
    const updated = proofRow({ analysis_status: 'failed' });
    const { db, set } = makeDb(existing, updated);
    const service = new PaymentProofsService(db, {} as never);

    await expect(service.recordAnalysis(existing.id, { status: 'failed' })).resolves.toMatchObject({
      analysisStatus: 'failed',
      analysisVerdict: null,
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'failed',
        analysis_verdict: null,
        analyzed_at: null,
      }),
    );
  });
});
