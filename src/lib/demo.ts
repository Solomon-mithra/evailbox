import { preferencesSchema } from './validation';
import type { Workspace, Tag, Email, Filters } from '@/types';
import type { TagInput } from './validation';
import type { WorkspaceId } from './workspace-selection';
import { migrateStoredValue } from './browser-storage';
import { TAG_HISTORY_LIMIT } from './tag-policy';
const storageKey = 'evailbox-demo-v1';
// Read old keys once so the rename preserves existing demo changes.
const legacyStorageKey = 'jevinbox-demo-v1';
const legacyWorkspaceKey = (workspace: WorkspaceId) =>
  workspace === 'PERSONAL' ? legacyStorageKey : legacyStorageKey + '-work';
const workspaceKey = (workspace: WorkspaceId) =>
  workspace === 'PERSONAL' ? storageKey : storageKey + '-work';
const tags: Tag[] = [
  {
    id: 'immigration',
    name: 'Immigration',
    description: 'Updates that move your application forward.',
    prompt:
      'Match official immigration notices, case updates, interview appointments, and requests for evidence.',
    priority: 'HIGH',
    keywords: ['case', 'USCIS', 'interview'],
    senders: [],
    version: 1,
  },
  {
    id: 'opportunities',
    name: 'Opportunities',
    description: 'The next interesting thing.',
    prompt:
      'Match personal job opportunities, interview invitations, and relevant introductions from recruiters.',
    priority: 'HIGH',
    keywords: ['role', 'opportunity', 'interview'],
    senders: [],
    version: 1,
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Invoices, receipts, and account updates.',
    prompt: 'Match invoices, payment receipts, financial account updates, and billing reminders.',
    priority: 'MEDIUM',
    keywords: ['invoice', 'payment', 'receipt'],
    senders: [],
    version: 1,
  },
  {
    id: 'reading',
    name: 'Worth a read',
    description: 'Ideas to come back to when there’s time.',
    prompt:
      'Match newsletters and thoughtful articles about design, technology, and artificial intelligence.',
    priority: 'LOW',
    keywords: ['newsletter', 'design', 'research'],
    senders: [],
    version: 1,
  },
];
export function seedDemo(): Workspace {
  const now = Date.now();
  const samples: [string, string, string, string, string, number, string, number, boolean][] = [
    [
      'USCIS',
      'updates@uscis.example',
      'Your case status has been updated',
      'We have an update on your application. Sign in to your account to review the latest information.',
      'immigration',
      98,
      'gmail',
      0.3,
      false,
    ],
    [
      'Maya Chen',
      'maya@northstar.example',
      'A role I thought you’d be great for',
      'Hi Alex, I came across your work and wanted to reach out about a product engineering opportunity on our team.',
      'opportunities',
      96,
      'outlook',
      0.8,
      false,
    ],
    [
      'Daniel Kim',
      'daniel@studio.example',
      'Let’s find a time to talk',
      'Thanks for your interest. We’d love to schedule your next interview. Are you free sometime next week?',
      'opportunities',
      93,
      'gmail',
      2,
      false,
    ],
    [
      'Mercury',
      'receipts@mercury.example',
      'Your monthly account statement is ready',
      'Your September statement is available. Here’s a quick overview of this month’s account activity.',
      'finance',
      99,
      'gmail',
      3,
      true,
    ],
    [
      'Linear',
      'billing@linear.example',
      'Your receipt from Linear',
      'Thanks for your payment. Your team’s monthly subscription has been renewed. Your receipt is attached.',
      'finance',
      97,
      'outlook',
      5,
      true,
    ],
    [
      'Lenny’s Newsletter',
      'lenny@newsletter.example',
      'What the best product teams do differently',
      'This week: a conversation about building products people love, and the small decisions that make a difference.',
      'reading',
      94,
      'gmail',
      20,
      true,
    ],
    [
      'Sophie Martin',
      'sophie@friends.example',
      'Coffee next week?',
      'Hey! I’ll be in your neighborhood on Thursday. Would love to catch up if you’re around.',
      '',
      0,
      'gmail',
      25,
      false,
    ],
    [
      'The Pragmatic Engineer',
      'hello@pragmatic.example',
      'Inside the engineering teams building with AI',
      'A closer look at how engineering teams are changing their workflows, and what’s actually working.',
      'reading',
      91,
      'outlook',
      28,
      true,
    ],
    [
      'Notion',
      'team@notion.example',
      'Your workspace, a little more organized',
      'A few ideas for keeping your projects and notes connected this week.',
      'reading',
      85,
      'gmail',
      47,
      true,
    ],
  ];
  const emails: Email[] = samples.map(
    ([name, sender, subject, snippet, tagId, confidence, account, hours, isRead], i) => ({
      id: `demo-${i}`,
      accountId: account,
      subject,
      sender,
      senderName: name,
      snippet,
      body: `${snippet}\n\nThis is a sample email in the evailbox demo workspace. Connect your own accounts in a configured live workspace to see real messages here.\n\nBest,\n${name}`,
      receivedAt: new Date(now - hours * 3600000).toISOString(),
      isRead,
      handled: false,
      webUrl:
        account === 'gmail'
          ? 'https://mail.google.com/mail/u/0/#inbox'
          : 'https://outlook.live.com/mail/0/inbox',
      classifications: tagId
        ? [
            {
              id: `c-${i}`,
              tagId,
              tagVersion: 1,
              matched: true,
              confidence,
              reasoning: `Illustrative demo result for the “${tags.find((t) => t.id === tagId)!.name}” rule. This score was not produced by a live AI evaluation.`,
              decision: 'match',
              tag: tags.find((t) => t.id === tagId)!,
            },
          ]
        : [],
    }),
  );
  return {
    user: { id: 'demo-user', email: 'alex@example.com' },
    tags: structuredClone(tags),
    accounts: [
      {
        id: 'gmail',
        provider: 'GMAIL',
        email: 'alex@gmail.example',
        lastSync: new Date(now - 180000).toISOString(),
        syncError: null,
      },
      {
        id: 'outlook',
        provider: 'OUTLOOK',
        email: 'alex@outlook.example',
        lastSync: new Date(now - 180000).toISOString(),
        syncError: null,
      },
    ],
    emails,
    preferences: {
      refreshMinutes: 5,
    },
    total: emails.length,
    page: 0,
    pageSize: 50,
  };
}
export function readDemo(workspace: WorkspaceId = 'PERSONAL'): Workspace {
  const key = workspaceKey(workspace);
  try {
    const saved = migrateStoredValue(key, legacyWorkspaceKey(workspace));
    if (saved) {
      const data = JSON.parse(saved) as Workspace;
      // Only generated sample copy changes; user-authored rules remain verbatim.
      let changed = false;
      for (const email of data.emails) {
        const body = email.body?.replace(
          'This is a sample email in the JevInbox demo workspace.',
          'This is a sample email in the evailbox demo workspace.',
        );
        if (body !== undefined && body !== email.body) {
          email.body = body;
          changed = true;
        }
        for (const classification of email.classifications) {
          const reasoning = classification.reasoning
            .replace(
              'This score was not produced by a live Jev call.',
              'This score was not produced by a live AI evaluation.',
            )
            .replace(
              'Demo keyword/sender rule result. Live Jev was not called.',
              'Demo keyword/sender rule result. Live AI was not called.',
            );
          if (reasoning !== classification.reasoning) {
            classification.reasoning = reasoning;
            changed = true;
          }
        }
      }
      if (changed) {
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch {}
      }
      return data;
    }
  } catch {}
  const fresh = seedDemo();
  if (workspace === 'WORK') {
    fresh.tags = [];
    fresh.accounts = [];
    fresh.emails = [];
    fresh.total = 0;
  }
  localStorage.setItem(key, JSON.stringify(fresh));
  return fresh;
}
export function filterWorkspace(workspace: Workspace, filters: Filters): Workspace {
  const emails = workspace.emails.filter(
    (e) =>
      (!filters.search ||
        `${e.subject} ${e.sender} ${e.senderName}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())) &&
      (!filters.account || e.accountId === filters.account) &&
      (!filters.tag || e.classifications.some((c) => c.matched && c.tagId === filters.tag)) &&
      (!filters.range ||
        filters.range === 'all' ||
        new Date(e.receivedAt).getTime() >=
          Date.now() - (filters.range === 'week' ? 7 : 30) * 86400000),
  );
  const page = filters.page ?? 0;
  const needsYou = workspace.emails
    .filter(
      (e) =>
        !e.handled &&
        !e.isRead &&
        e.classifications.some((c) => c.matched && c.tag.priority === 'HIGH'),
    )
    .sort(
      (a, b) =>
        Math.max(
          ...b.classifications
            .filter((c) => c.matched && c.tag.priority === 'HIGH')
            .map((c) => c.confidence),
        ) -
        Math.max(
          ...a.classifications
            .filter((c) => c.matched && c.tag.priority === 'HIGH')
            .map((c) => c.confidence),
        ),
    );
  return {
    ...workspace,
    needsYou,
    needsTotal: needsYou.length,
    tagCounts: Object.fromEntries(
      workspace.tags.map((t) => [
        t.id,
        workspace.emails.filter((e) => e.classifications.some((c) => c.matched && c.tagId === t.id))
          .length,
      ]),
    ),
    emails: emails.slice(page * 50, (page + 1) * 50),
    total: emails.length,
    page,
  };
}
export function mutateDemo(
  path: string,
  method: string,
  body: unknown,
  workspace: WorkspaceId = 'PERSONAL',
) {
  const w = readDemo(workspace);
  const data = (body ?? {}) as Record<string, unknown>;
  const id = path.split('/').at(-1);
  if (path === '/api/tags' && method === 'POST') {
    const tag = data as unknown as TagInput;
    if (w.tags.some((t) => t.name.toLowerCase() === tag.name.toLowerCase()))
      throw new Error('A tag with this name already exists.');
    w.tags.push({ ...tag, id: crypto.randomUUID(), version: 1 });
  } else if (path.startsWith('/api/tags/')) {
    if (method === 'DELETE') {
      w.tags = w.tags.filter((t) => t.id !== id);
      w.emails.forEach(
        (e) => (e.classifications = e.classifications.filter((c) => c.tagId !== id)),
      );
    } else {
      if (
        w.tags.some((t) => t.id !== id && t.name.toLowerCase() === String(data.name).toLowerCase())
      )
        throw new Error('A tag with this name already exists.');
      const current = w.tags.find((t) => t.id === id);
      const matchingChanged =
        current &&
        (['name', 'prompt', 'keywords', 'senders'] as const).some(
          (key) =>
            data[key] !== undefined && JSON.stringify(data[key]) !== JSON.stringify(current[key]),
        );
      w.tags = w.tags.map((t) =>
        t.id === id ? { ...t, ...data, version: t.version + (matchingChanged ? 1 : 0) } : t,
      );
      if (matchingChanged)
        w.emails.forEach(
          (e) => (e.classifications = e.classifications.filter((c) => c.tagId !== id)),
        );
      else {
        const updated = w.tags.find((t) => t.id === id);
        if (updated)
          w.emails.forEach((email) =>
            email.classifications.forEach((classification) => {
              if (classification.tagId === id) classification.tag = updated;
            }),
          );
      }
    }
  } else if (path.startsWith('/api/emails/') && path.endsWith('/actions')) {
    const messageId = path.split('/').at(-2);
    if (data.action === 'archive') w.emails = w.emails.filter((e) => e.id !== messageId);
    else if (data.action === 'read' || data.action === 'unread')
      w.emails = w.emails.map((e) =>
        e.id === messageId ? { ...e, isRead: data.action === 'read' } : e,
      );
  } else if (path.startsWith('/api/emails/')) {
    w.emails = w.emails.map((e) => (e.id === id ? { ...e, handled: Boolean(data.handled) } : e));
  } else if (path.startsWith('/api/accounts/')) {
    w.accounts = w.accounts.filter((a) => a.id !== id);
    w.emails = w.emails.filter((e) => e.accountId !== id);
  } else if (path === '/api/settings') {
    w.preferences = {
      refreshMinutes: preferencesSchema.parse(data).refreshMinutes ?? w.preferences.refreshMinutes,
    };
  } else if (path === '/api/sync') {
    w.accounts = w.accounts.map((a) => ({ ...a, lastSync: new Date().toISOString() }));
  } else if (path.startsWith('/api/classify')) {
    const selectedTags = w.tags.filter((tag) => !data.tagId || tag.id === data.tagId);
    const isPending = (email: Email, tag: Tag) =>
      !email.classifications.some((c) => c.tagId === tag.id && c.tagVersion === tag.version);
    const pending = w.emails
      .filter(
        (email) =>
          (!data.emailId || email.id === data.emailId) &&
          (!Array.isArray(data.emailIds) || data.emailIds.includes(email.id)) &&
          selectedTags.some((tag) => isPending(email, tag)),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
      .slice(0, TAG_HISTORY_LIMIT);
    for (const e of pending) {
      for (const t of selectedTags) {
        if (!isPending(e, t)) continue;
        const match =
          t.keywords.some((k) =>
            `${e.subject} ${e.snippet}`.toLowerCase().includes(k.toLowerCase()),
          ) || t.senders.includes(e.sender);
        e.classifications = e.classifications.filter((c) => c.tagId !== t.id);
        e.classifications.push({
          id: crypto.randomUUID(),
          tagId: t.id,
          tagVersion: t.version,
          tag: t,
          matched: match,
          confidence: match ? 100 : 0,
          decision: match ? 'match' : 'no_match',
          reasoning: 'Demo keyword/sender rule result. Live AI was not called.',
        });
      }
    }
  } else if (path === '/api/user') {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(workspaceKey('WORK'));
    localStorage.removeItem(legacyStorageKey);
    localStorage.removeItem(legacyWorkspaceKey('WORK'));
    return;
  }
  localStorage.setItem(workspaceKey(workspace), JSON.stringify(w));
  if (path === '/api/settings') {
    const other = workspace === 'PERSONAL' ? 'WORK' : 'PERSONAL';
    const sibling = readDemo(other);
    sibling.preferences = { ...w.preferences };
    localStorage.setItem(workspaceKey(other), JSON.stringify(sibling));
  }
}

/** Mirrors the live receivedAt/id cursor order while keeping sample message bodies local. */
export function demoInbox(source: Workspace, filters: Filters): import('@/types').InboxPage {
  const anchor: { receivedAt: string; id: string } | undefined = filters.cursor
    ? JSON.parse(filters.cursor)
    : undefined;
  const ordered = source.emails
    .filter(
      (email) =>
        (!anchor ||
          email.receivedAt < anchor.receivedAt ||
          (email.receivedAt === anchor.receivedAt && email.id < anchor.id)) &&
        (filters.needs !== '1' ||
          (!email.handled &&
            !email.isRead &&
            email.classifications.some((c) => c.matched && c.tag.priority === 'HIGH'))),
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  const page = filterWorkspace({ ...source, emails: ordered }, { ...filters, page: 0 });
  const last = page.emails.at(-1);
  return {
    emails: page.emails,
    pageSize: 50,
    nextCursor:
      page.total > 50 && last ? JSON.stringify({ receivedAt: last.receivedAt, id: last.id }) : null,
  };
}
