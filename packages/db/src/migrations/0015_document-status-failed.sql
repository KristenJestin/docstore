-- A document whose pipeline gave up after its last retry leaves `processing`
-- for `failed`, with the reason in `processing_error`.
ALTER TYPE "public"."document_status" ADD VALUE 'failed';
