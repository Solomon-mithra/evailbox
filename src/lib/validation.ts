import { z } from 'zod';
export const tagSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(500).default(''),
    prompt: z.string().trim().min(10).max(2000),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    senders: z.array(z.email().max(254)).max(30).default([]),
  })
  .strict();
export const preferencesSchema = z
  .object({
    refreshMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();
export const idSchema = z.string().min(1).max(100);
export const classifySchema = z
  .object({
    emailId: idSchema.optional(),
    emailIds: z.array(idSchema).max(20).optional(),
    tagId: idSchema.optional(),
  })
  .strict();
export type TagInput = z.infer<typeof tagSchema>;
