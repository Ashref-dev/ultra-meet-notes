import React from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { cn } from "@/lib/utils";

const About = dynamic(() => import("./About").then((module) => module.About));

interface LogoProps {
  size?: number;
  className?: string;
  showDialog?: boolean;
  mono?: boolean;
}

export function LogoGlyph({ size = 28, className, mono = false }: { size?: number; className?: string; mono?: boolean }) {
  const gradientId = React.useId();
  const fillValue = mono ? "currentColor" : `url(#${gradientId})`;
  return (
    <svg
      width={size}
      height={size * (128 / 86)}
      viewBox="0 0 86 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path d="M6.2816 30.7681L21.8862 44.6388V92.6084C21.8862 93.8346 21.399 95.0106 20.5319 95.8777C19.6649 96.7448 18.4888 97.2319 17.2626 97.2319H16.6846L1.08008 83.3612V35.3916C1.08008 34.1654 1.5672 32.9894 2.43429 32.1223C3.30138 31.2552 4.4774 30.7681 5.70365 30.7681H6.2816Z" fill={fillValue} />
      <path d="M49.0683 -0.441071C50.2945 -0.441071 51.4705 0.0460544 52.3376 0.913143C53.2047 1.78023 53.6918 2.95626 53.6918 4.1825V114.57L38.0873 128.441H37.5093C36.2831 128.441 35.107 127.954 34.24 127.087C33.3729 126.22 32.8857 125.044 32.8857 123.817V12.8517L49.6462 -0.441071H49.0683Z" fill={fillValue} />
      <path d="M69.316 30.7681L84.9205 44.0608V83.9392L69.316 97.2319C68.0897 97.2319 66.9137 96.7448 66.0466 95.8777C65.1795 95.0106 64.6924 93.8346 64.6924 92.6084V35.3916C64.6924 34.1654 65.1795 32.9894 66.0466 32.1223C66.9137 31.2552 68.0897 30.7681 69.316 30.7681Z" fill={fillValue} />
      {!mono && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="86" y2="128" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5B4DCC" />
            <stop offset="0.25" stopColor="#8A6FD1" />
            <stop offset="0.5" stopColor="#F06A8B" />
            <stop offset="0.75" stopColor="#FF8A3D" />
            <stop offset="1" stopColor="#FFD166" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(
  ({ size = 28, className, showDialog = true, mono = false }, ref) => {
    const icon = <LogoGlyph size={size} mono={mono} />;

    if (!showDialog) {
      return <span className={cn("inline-flex items-center justify-center", className)}>{icon}</span>;
    }

    return (
      <Dialog aria-describedby={undefined}>
        <DialogTrigger asChild>
          <button
            type="button"
            ref={ref}
            aria-label="About Ultra"
            className={cn(
              "inline-flex items-center justify-center rounded-lg bg-transparent p-0 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              className
            )}
          >
            {icon}
          </button>
        </DialogTrigger>
        <DialogContent>
          <VisuallyHidden>
            <DialogTitle>About Ultra</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    );
  }
);

Logo.displayName = "Logo";

export default Logo;
