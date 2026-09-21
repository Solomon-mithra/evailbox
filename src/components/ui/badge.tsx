import type { Tag } from '@/types';
export function TagBadge({
  tag,
  confidence,
}: {
  tag: Pick<Tag, 'name' | 'priority'>;
  confidence?: number;
}) {
  return (
    <span className={`tag-badge tag-${tag.priority.toLowerCase()}`}>
      <span className="tag-dot" />
      {tag.name}
      {confidence !== undefined && confidence > 80 && (
        <span className="confidence">{Math.round(confidence)}%</span>
      )}
    </span>
  );
}
