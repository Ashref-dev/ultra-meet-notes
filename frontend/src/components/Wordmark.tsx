import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  height?: number;
  title?: string;
}

export function Wordmark({ className, height = 20, title = "Ultra" }: WordmarkProps) {
  return (
    <span
      className={cn("font-display tracking-[0.08em]", className)}
      style={{ fontSize: height * 0.75, color: "currentColor" }}
      title={title}
    >
      Ultra
    </span>
  );
}
