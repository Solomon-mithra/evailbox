/** Existing email lookback, shared by tag creation and explicit match checks. */
export const TAG_HISTORY_LIMIT = 100;

export const TAG_SCOPE_NOTICE = `Checks up to your ${TAG_HISTORY_LIMIT} most recent emails in this workspace, including unprocessed emails, and new emails as they arrive. Older emails are not checked automatically.`;

export const TAG_EDIT_NOTICE = `Changes to the name or matching rules replace previous results and check up to your ${TAG_HISTORY_LIMIT} most recent emails. New emails are checked automatically.`;

export const TAG_CHECK_NOTICE = `Check for matches processes up to ${TAG_HISTORY_LIMIT} of the most recent emails still needing a check. Each click checks one batch. New emails are tagged automatically.`;
