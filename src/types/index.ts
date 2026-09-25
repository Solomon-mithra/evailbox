export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Provider = 'GMAIL' | 'OUTLOOK';
export interface User {
  id: string;
  email: string;
  workRequested?: boolean;
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
export interface InboxCounts {
  total: number;
  needsTotal: number;
  tagCounts: Record<string, number>;
}
export interface WorkspaceMetadata {
  user: User;
  tags: Tag[];
  accounts: EmailAccount[];
}
