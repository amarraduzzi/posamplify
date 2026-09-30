import { Star } from 'lucide-react';

/** "Leave us a Google review": only for a real https link set by the owner. */
export function ReviewButton({ url, label, hint }: { url?: string; label: string; hint: string }) {
  if (!url || !/^https:\/\/\S+$/.test(url)) return null;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-sm text-muted">{hint}</p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="press inline-flex items-center gap-2 rounded-full card px-5 h-12 font-semibold">
        <span className="flex text-brand" aria-hidden>{[0, 1, 2, 3, 4].map(i => <Star key={i} className="size-4 fill-current" />)}</span>
        {label}
      </a>
    </div>
  );
}
