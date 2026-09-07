-- Custom SQL migration file, put your code below! -----
-- A `date_precision` without a `document_date` describes nothing: it is the
-- residue of an edit that cleared the date before `document.update` learnt to
-- clear the precision along with it. Those rows used to be rejected by the
-- validation of every later patch, which made them impossible to edit at all.
UPDATE "document" SET "date_precision" = NULL
WHERE "document_date" IS NULL AND "date_precision" IS NOT NULL;
