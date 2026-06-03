
interface ConfidenceBadgeProps {
  confidence: number;
  showLabel?: boolean;
}

export function ConfidenceBadge({ confidence, showLabel = true }: ConfidenceBadgeProps) {
  let color = 'text-emerald-400 bg-emerald-900/40 border-emerald-800';
  let label = 'High';

  if (confidence < 70) {
    color = 'text-red-400 bg-red-900/40 border-red-800';
    label = 'Low';
  } else if (confidence < 95) {
    color = 'text-amber-400 bg-amber-900/40 border-amber-800';
    label = 'Med';
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-mono ${color}`}>
      {confidence}%{showLabel && <span className="font-sans">{label}</span>}
    </span>
  );
}
