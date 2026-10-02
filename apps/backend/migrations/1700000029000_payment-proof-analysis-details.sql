-- Up Migration
-- Detalle auditable del análisis automático de comprobantes.
-- El análisis solo marca; nunca acepta ni rechaza un payment_attempt.

alter table payment_proofs
  add column analysis_amount numeric(10,2),
  add column analysis_reference text,
  add column analysis_model text,
  add column analysis_destination_account text,
  add column analysis_destination_holder text,
  add column analysis_destination_bank text,
  add column analyzed_at timestamptz;

alter table payment_proofs
  add constraint payment_proofs_analysis_amount_label_check
  check (
    analysis_amount_label is null
    or analysis_amount_label in ('pago_total','pago_productos','revisar_monto')
  );

alter table payment_proofs
  add constraint payment_proofs_analysis_coherence
  check (
    (
      analysis_status = 'ok'
      and analysis_verdict is not null
      and analyzed_at is not null
    )
    or (
      analysis_status <> 'ok'
      and analysis_verdict is null
      and analyzed_at is null
    )
  );

create index idx_payment_proofs_analysis_reference
  on payment_proofs (analysis_reference)
  where analysis_reference is not null;

-- Down Migration
drop index if exists idx_payment_proofs_analysis_reference;

alter table payment_proofs
  drop constraint if exists payment_proofs_analysis_coherence,
  drop constraint if exists payment_proofs_analysis_amount_label_check,
  drop column if exists analyzed_at,
  drop column if exists analysis_destination_bank,
  drop column if exists analysis_destination_holder,
  drop column if exists analysis_destination_account,
  drop column if exists analysis_model,
  drop column if exists analysis_reference,
  drop column if exists analysis_amount;
