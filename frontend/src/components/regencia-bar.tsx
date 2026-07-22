import { getRegenciaBarColor, getRegenciaColor } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface RegenciaBarProps {
  percentual: number;
  meta?: number;
  showMeta?: boolean;
}

export function RegenciaBar({ percentual, meta = 70, showMeta = true }: RegenciaBarProps) {
  const clamped = Math.min(percentual, 120);
  const barColor = getRegenciaBarColor(percentual);
  const textColor = getRegenciaColor(percentual);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={cn("font-semibold", textColor)}>{percentual.toFixed(1)}%</span>
        {showMeta && <span className="text-gray-400">Meta: {meta}%</span>}
      </div>
      <div className="relative h-2 w-full rounded-full bg-gray-100">
        <div
          className={cn("h-2 rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(clamped, 100)}%` }}
        />
        {showMeta && (
          <div
            className="absolute top-0 h-2 w-0.5 bg-gray-400"
            style={{ left: `${meta}%` }}
          />
        )}
      </div>
    </div>
  );
}
