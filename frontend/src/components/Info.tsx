import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button 
          type="button"
          ref={ref} 
          className={`flex items-center justify-center mb-2 cursor-pointer border-none transition-colors ${
            isCollapsed 
              ? "rounded-lg bg-transparent p-2 text-muted-foreground hover:bg-accent hover:text-foreground" 
              : "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
          }`}
          title="About Ultra"
        >
          <InfoIcon className={`${isCollapsed ? "h-5 w-5" : "h-4 w-4"}`} />
          {!isCollapsed && (
            <span className="ml-2 text-sm text-foreground">About</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-0">
        <VisuallyHidden>
          <DialogTitle>About Ultra</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info; 
