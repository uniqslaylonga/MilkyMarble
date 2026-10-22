-- OPTIONAL. Run only if marking a request as received fails with a CHECK constraint
-- violation on public.expenses.status (error code 23514). If the status column is
-- plain text with no CHECK, skip this file.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.expenses DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('PENDING_CEO','PENDING_FINANCE','APPROVED','PURCHASED','RECEIVED','REJECTED'));
