"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

interface DepartmentAvatarProps {
  name: string;
  code?: string;
  url?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function DepartmentAvatar({
  name,
  code,
  url,
  size = "md",
  className = "",
}: DepartmentAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const sizeClasses = {
    sm: "size-8 text-[11px]",
    md: "size-11 text-xs",
    lg: "size-14 text-sm",
    xl: "size-20 text-lg",
  }[size];

  const iconSizes = {
    sm: "size-4",
    md: "size-5",
    lg: "size-7",
    xl: "size-10",
  }[size];

  if (url && !imgFailed) {
    return (
      <div
        className={`${sizeClasses} shrink-0 overflow-hidden rounded-xl border border-primary/20 bg-white p-0.5 shadow-2xs ${className}`}
      >
        <img
          src={url}
          alt={name}
          onError={() => setImgFailed(true)}
          className="size-full rounded-[10px] object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 rounded-xl bg-primary/10 border border-primary/25 text-primary font-bold flex flex-col items-center justify-center shadow-2xs select-none tracking-tight ${className}`}
      aria-label={`${name} (${code ?? "Department"})`}
    >
      {code ? (
        <span className="truncate max-w-full px-1">{code}</span>
      ) : (
        <Building2 className={iconSizes} />
      )}
    </div>
  );
}
