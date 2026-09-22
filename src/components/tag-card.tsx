'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { ArrowRight, Inbox, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { Tag } from '@/types';
import { Button } from './ui/button';

export function TagCard({
  tag,
  matchCount,
  onEdit,
  onDelete,
}: {
  tag: Tag;
  matchCount?: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const titleId = `tag-card-${tag.id}`;
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const deleteRequested = useRef(false);
  const priority = tag.priority.toLowerCase();
  const keywords = tag.keywords.slice(0, 3);

  return (
    <article className="tag-card" aria-labelledby={titleId}>
      <div className="tag-card-header">
        <div className="tag-card-heading">
          <h3 id={titleId}>
            <Link className="tag-card-link" href={`/tags/${tag.id}`}>
              {tag.name}
              <span className="sr-only"> — view matching emails</span>
            </Link>
          </h3>
          <span className={`tag-card-priority tag-${priority}`}>
            <span className="tag-dot" aria-hidden="true" />
            {priority} priority
          </span>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            ref={menuTrigger}
            className="icon-button tag-card-control tag-card-more"
            aria-label={`More options for ${tag.name}`}
          >
            <MoreHorizontal size={19} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content tag-card-menu"
              align="end"
              onCloseAutoFocus={(event) => {
                if (!deleteRequested.current) return;
                event.preventDefault();
                deleteRequested.current = false;
                // Open after menu dismissal so the dialog returns to a lasting control.
                menuTrigger.current?.focus();
                onDelete();
              }}
            >
              <DropdownMenu.Item
                onSelect={() => {
                  deleteRequested.current = true;
                }}
                className="danger-text"
              >
                <Trash2 size={16} />
                Delete tag
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <p className="tag-card-rule">{tag.prompt}</p>

      {(keywords.length > 0 || tag.senders.length > 0) && (
        <div className="tag-card-signals">
          {keywords.length > 0 && (
            <div className="tag-card-keywords">
              <span className="sr-only">Keywords: </span>
              {keywords.map((keyword, index) => (
                <span className="tag-card-keyword" key={`${keyword}-${index}`}>
                  {keyword}
                </span>
              ))}
              {tag.keywords.length > keywords.length && (
                <span className="tag-card-extra">
                  +{tag.keywords.length - keywords.length}
                  <span className="sr-only"> more keywords</span>
                </span>
              )}
            </div>
          )}
          {tag.senders.length > 0 && (
            <span className="tag-card-senders">
              {tag.senders.length} {tag.senders.length === 1 ? 'sender' : 'senders'}
            </span>
          )}
        </div>
      )}

      <div className="tag-card-footer">
        <span className="tag-card-matches">
          <Inbox size={17} aria-hidden="true" />
          <span>
            {matchCount === undefined ? (
              'View matches'
            ) : matchCount === 0 ? (
              'No matches yet'
            ) : (
              <>
                <strong>{matchCount.toLocaleString('en-US')}</strong>{' '}
                {matchCount === 1 ? 'matching email' : 'matching emails'}
              </>
            )}
          </span>
          <ArrowRight size={16} className="tag-card-arrow" aria-hidden="true" />
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="tag-card-control tag-card-edit"
          aria-label={`Edit rule for ${tag.name}`}
          onClick={onEdit}
        >
          <Pencil size={14} />
          Edit rule
        </Button>
      </div>
    </article>
  );
}
