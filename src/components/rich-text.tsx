import { descriptionToHtml } from '@/server/lib/description';
import { cn } from '@/lib/utils';

/**
 * Renders a stored event description (ADR-010). The value is sanitised on
 * write, and `descriptionToHtml` sanitises again here — defence in depth is
 * cheap, and this is the one place `dangerouslySetInnerHTML` is allowed for
 * organizer-authored content. Renders nothing for an empty description.
 */
export function RichText({
  description,
  className,
}: {
  description: string | null | undefined;
  className?: string;
}) {
  const html = descriptionToHtml(description);
  if (!html) return null;
  return <div className={cn('rich-text', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
