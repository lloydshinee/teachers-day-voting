"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl";
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = "md",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const maxWidthClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
  }[maxWidth];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-150"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Modal Dialog Body */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative z-10 w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-150 overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 p-5 bg-muted/20">
          <div>
            <h2
              id="modal-title"
              className="text-lg font-bold tracking-tight text-foreground"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
