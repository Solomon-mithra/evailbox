export type EmailThreadMessage = {
  id: string;
  sender: string;
  senderName: string;
  receivedAt: string;
  html: string;
  current: boolean;
  fallback: boolean;
};
export type EmailThread = { messages: EmailThreadMessage[]; partial: boolean };
