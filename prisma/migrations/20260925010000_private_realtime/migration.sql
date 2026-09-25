-- Optional in isolated Postgres; hosted Supabase supplies the realtime schema.
-- Clients may receive their own invalidation signals, never publish them.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY evailbox_inbox_signals ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        extension = ''broadcast'' AND
        realtime.topic() IN (
          ''inbox:'' || (SELECT auth.uid())::text || '':PERSONAL'',
          ''inbox:'' || (SELECT auth.uid())::text || '':WORK''
        )
      )';
  END IF;
END $$;
