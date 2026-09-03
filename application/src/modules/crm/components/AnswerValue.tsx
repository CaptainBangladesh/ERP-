import { answerParts, firstUrlIn, hrefFor, isEmail, prettyUrl } from '../survey-answers';
import { ExternalLinkIcon } from '../icons';

/**
 * One survey answer, rendered so a person can actually read and use it.
 *
 * The same value shows up in two places — the Survey tab lists them all, the workspace rail shows
 * the top few — and both were rendering raw strings: a multi-select came through as a comma blob,
 * and a link came through as unclickable text that ran off the edge of the rail. So the rules for
 * turning a stored value into something scannable and clickable live here, once.
 *
 * - A value that is several answers (a multi-select, a Google Form grid) becomes a list, not
 *   `"Yes, Yes, No"`.
 * - A value that is a web address or email becomes a link, shown by its destination rather than
 *   its full tracking-laden URL, and truncated so it can never break the column it sits in.
 */
export function AnswerValue({ value, className = '' }: { value: unknown; className?: string }) {
  const parts = answerParts(value);

  if (parts.length === 0) {
    return <span className="text-xs italic text-slate-400">No answer given</span>;
  }

  if (parts.length === 1) {
    return <AnswerPart text={parts[0]!} className={className} />;
  }

  return (
    <ul className="flex flex-col gap-1">
      {parts.map((part, index) => (
        <li key={`${part}-${index}`} className="flex min-w-0 items-start gap-1.5">
          <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
          <AnswerPart text={part} className={className} />
        </li>
      ))}
    </ul>
  );
}

function AnswerPart({ text, className }: { text: string; className: string }) {
  const trimmed = text.trim();
  const url = firstUrlIn(trimmed);

  if (url) {
    return (
      <a
        href={hrefFor(url)}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className={`inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden font-semibold text-teal-700 underline decoration-teal-300 decoration-1 underline-offset-2 transition hover:text-teal-900 hover:decoration-teal-500 ${className}`}
      >
        <span className="min-w-0 truncate">{prettyUrl(url)}</span>
        <span aria-hidden="true" className="shrink-0 text-teal-500">
          <ExternalLinkIcon size={12} />
        </span>
      </a>
    );
  }

  if (isEmail(trimmed)) {
    return (
      <a
        href={hrefFor(trimmed)}
        title={trimmed}
        className={`min-w-0 break-all font-semibold text-teal-700 underline decoration-teal-300 decoration-1 underline-offset-2 transition hover:text-teal-900 ${className}`}
      >
        {trimmed}
      </a>
    );
  }

  return <span className={`break-words ${className}`}>{trimmed}</span>;
}
