-- Ports the Postgres triggers that bound which mail a tag may check (see src/lib/tag-scope.ts).
-- Prisma stores SQLite DateTime as integer milliseconds. Triggers run inside the inserting
-- statement, which holds SQLite's single write lock, so stamps and snapshots are ordered.

-- Arrival time is assigned by the database at insert, not supplied by the caller. A page that
-- commits after a history snapshot therefore always counts as new mail for that tag.
CREATE TRIGGER "emails_stamp_arrival" AFTER INSERT ON "emails"
BEGIN
  UPDATE "emails" SET "createdAt" = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE "id" = NEW."id";
END;

-- A new or re-versioned tag checks at most the latest 100 Inbox emails, plus everything after.
CREATE TRIGGER "tags_capture_history_insert" AFTER INSERT ON "tags"
BEGIN
  UPDATE "tags" SET
    "matchFrom" = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    "historyEmailIds" = (
      SELECT json_group_array("id") FROM (
        SELECT e."id" FROM "emails" e
        WHERE e."userId" = NEW."userId" AND e."workspace" = NEW."workspace" AND e."inInbox" = true
        ORDER BY e."receivedAt" DESC, e."id" DESC LIMIT 100
      )
    )
  WHERE "id" = NEW."id";
END;

CREATE TRIGGER "tags_capture_history_version" AFTER UPDATE OF "version" ON "tags"
WHEN NEW."version" <> OLD."version"
BEGIN
  UPDATE "tags" SET
    "matchFrom" = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    "historyEmailIds" = (
      SELECT json_group_array("id") FROM (
        SELECT e."id" FROM "emails" e
        WHERE e."userId" = NEW."userId" AND e."workspace" = NEW."workspace" AND e."inInbox" = true
        ORDER BY e."receivedAt" DESC, e."id" DESC LIMIT 100
      )
    )
  WHERE "id" = NEW."id";
END;
