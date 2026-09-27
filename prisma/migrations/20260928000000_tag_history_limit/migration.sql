ALTER TABLE public.tags
  ADD COLUMN "matchFrom" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "historyEmailIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT tags_history_limit CHECK (cardinality("historyEmailIds") <= 100);

ALTER TABLE public.emails ALTER COLUMN "createdAt" TYPE TIMESTAMP(6);

-- Imports and history snapshots share a transaction lock. A page that commits
-- after a snapshot must get an arrival time after that snapshot, even if its
-- transaction began earlier. Upsert updates retain the original arrival time.
CREATE FUNCTION public.stamp_email_arrival() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId"::text, 0));
  NEW."createdAt" := clock_timestamp()::timestamp;
  RETURN NEW;
END;
$$;
CREATE TRIGGER emails_stamp_arrival BEFORE INSERT ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.stamp_email_arrival();

-- One fixed history snapshot per request, shared across all worker batches/retries.
-- Snapshot all recent Inbox rows, not the next rows lacking a tag decision.
CREATE FUNCTION public.capture_tag_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId"::text, 0));
  NEW."matchFrom" := clock_timestamp()::timestamp;
  NEW."historyEmailIds" := ARRAY(
    SELECT e.id FROM public.emails e
    WHERE e."userId" = NEW."userId" AND e.workspace = NEW.workspace AND e."inInbox" = true
    ORDER BY e."receivedAt" DESC, e.id DESC LIMIT 100
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tags_capture_history
  BEFORE INSERT OR UPDATE OF version ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.capture_tag_history();

-- Bound legacy backlogs as well, without deleting any saved matches.
UPDATE public.tags t SET "matchFrom" = CURRENT_TIMESTAMP, "historyEmailIds" = ARRAY(
  SELECT e.id FROM public.emails e
  WHERE e."userId" = t."userId" AND e.workspace = t.workspace AND e."inInbox" = true
  ORDER BY e."receivedAt" DESC, e.id DESC LIMIT 100
);
