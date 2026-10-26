export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Provider = 'GMAIL' | 'OUTLOOK';
export interface User {
  id: string;
  email: string;
  workRequested?: boolean;
  /** Only true when APP_PASSWORD gates this instance. */
  canSignOut?: boolean;
}
export interface Tag {
  id: string;
  name: string;
  description: string;
  prompt: string;
  priority: Priority;
  keywords: string[];
  senders: string[];
  version: number;
}
export interface EmailAccount {
  id: string;
  email: string;
  provider: Provider;
  lastSync: string | null;
  syncError: string | null;
}
export interface EmailClassification {
  id: string;
  tagId: string;
  tagVersion: number;
  matched: boolean;
  confidence: number;
  reasoning: string;
  decision: string;
  tag: Pick<Tag, 'id' | 'name' | 'priority' | 'version'>;
}
export interface Email {
  id: string;
  accountId: string;
  subject: string;
  sender: string;
  senderName: string;
  snippet: string;
  body?: string | null;
  receivedAt: string;
  isRead: boolean;
  handled: boolean;
  webUrl: string;
  classifications: EmailClassification[];
}
export interface AppPreferences {
  refreshMinutes: number;
}
export interface Workspace {
  processing?: InboxProcessing;
  needsYou?: Email[];
  needsTotal?: number;
  tagCounts?: Record<string, number>;
  user: User;
  tags: Tag[];
  accounts: EmailAccount[];
  emails: Email[];
  preferences: AppPreferences;
  total: number;
  page: number;
  pageSize: number;
}
export interface Filters {
  search?: string;
  tag?: string;
  account?: string;
  range?: string;
  page?: number;
  cursor?: string;
  needs?: string;
}

/** Safe inbox representation; full message content lives only in the detail request. */
export type EmailSummary = Omit<Email, 'body'>;
export interface InboxPage {
  emails: EmailSummary[];
  pageSize: number;
  nextCursor: string | null;
}
export interface InboxProcessing {
  accounts?: InboxAccountProgress[];
  imported: number;
  tagged: number;
  remaining: number;
  importing: boolean;
  paused: boolean;
  /** False until an AI Gateway key is saved; pending tag work then waits instead of polling. */
  aiConfigured?: boolean;
}
export interface InboxAccountProgress {
  id: string;
  email: string;
  initialSync: boolean;
  syncing: boolean;
  imported: number;
  tagged: number;
  remaining: number;
  importing: boolean;
}
export interface InboxCounts {
  processing?: InboxProcessing;
  total: number;
  needsTotal: number;
  tagCounts: Record<string, number>;
}
export interface WorkspaceMetadata {
  user: User;
  tags: Tag[];
  accounts: EmailAccount[];
}
