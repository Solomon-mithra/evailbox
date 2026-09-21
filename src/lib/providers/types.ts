export type Provider = 'GMAIL' | 'OUTLOOK';
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: number };
export type ProviderEmail = {
  providerMessageId: string;
  subject: string;
  sender: string;
  senderName: string;
  snippet: string;
  body: string | null;
  receivedAt: Date;
  isRead: boolean;
  webUrl: string;
};
export type SyncPage = {
  messages: ProviderEmail[];
  cursor: string;
  hasMore: boolean;
  deletedIds?: string[];
  reset?: boolean;
};
