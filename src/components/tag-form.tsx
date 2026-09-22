'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { tagSchema, type TagInput } from '@/lib/validation';
import type { Tag } from '@/types';
import { useAction } from '@/hooks/useFetch';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Loader } from './ui/loader';
import { toast } from 'sonner';
type Fields = Omit<TagInput, 'keywords' | 'senders'> & { keywords: string; senders: string };
export function TagForm({
  tag,
  open,
  onOpenChange,
}: {
  tag?: Tag;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={tag ? 'Edit tag' : 'Create a tag'}
      description="Tell evailbox what matters to you. Be specific about what should match."
    >
      {open && <Form key={tag?.id ?? 'new'} tag={tag} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}
function Form({ tag, close }: { tag?: Tag; close: () => void }) {
  const mutation = useAction();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError: fieldError,
  } = useForm<Fields>({
    defaultValues: {
      name: tag?.name ?? '',
      description: tag?.description ?? '',
      prompt: tag?.prompt ?? '',
      priority: tag?.priority ?? 'MEDIUM',
      keywords: tag?.keywords.join(', ') ?? '',
      senders: tag?.senders.join(', ') ?? '',
    },
  });
  async function submit(values: Fields) {
    const parsed = tagSchema.safeParse({
      ...values,
      keywords: values.keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      senders: values.senders
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    });
    if (!parsed.success) {
      parsed.error.issues.forEach((i) =>
        fieldError(i.path[0] as keyof Fields, { message: i.message }),
      );
      return;
    }
    try {
      await mutation.mutateAsync({
        path: tag ? `/api/tags/${tag.id}` : '/api/tags',
        method: tag ? 'PATCH' : 'POST',
        body: parsed.data,
      });
      toast.success(tag ? 'Tag updated. Check for matches to refresh its emails.' : 'Tag created');
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save tag.');
    }
  }
  return (
    <form className="form-stack" onSubmit={handleSubmit(submit)}>
      <div className="form-grid">
        <label>
          Tag name
          <Input
            placeholder="e.g. Immigration"
            {...register('name')}
            aria-invalid={!!errors.name}
          />
          {errors.name && <small className="field-error">{errors.name.message}</small>}
        </label>
        <label>
          Priority
          <select className="input" {...register('priority')}>
            <option value="HIGH">High priority</option>
            <option value="MEDIUM">Medium priority</option>
            <option value="LOW">Low priority</option>
          </select>
        </label>
      </div>
      <label>
        Description <span className="optional">optional</span>
        <Input placeholder="A short description for this tag" {...register('description')} />
      </label>
      <label>
        What should evailbox look for?
        <Textarea
          placeholder="Match official notices about my immigration case, including interview invitations and requests for documents."
          rows={4}
          {...register('prompt')}
          aria-invalid={!!errors.prompt}
        />
        {errors.prompt ? (
          <small className="field-error">{errors.prompt.message}</small>
        ) : (
          <small className="field-hint">
            Describe the kind of email that belongs here. At least 10 characters.
          </small>
        )}
      </label>
      <label>
        Keywords <span className="optional">optional</span>
        <Input placeholder="case update, interview, USCIS" {...register('keywords')} />
        {errors.keywords && <small className="field-error">{errors.keywords.message}</small>}
        <small className="field-hint">Separate keywords with commas.</small>
      </label>
      <label>
        Senders <span className="optional">optional</span>
        <Input placeholder="updates@example.com, team@example.com" {...register('senders')} />
        {errors.senders && <small className="field-error">{errors.senders.message}</small>}
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader />}
          {tag ? 'Save changes' : 'Create tag'}
        </Button>
      </div>
    </form>
  );
}
