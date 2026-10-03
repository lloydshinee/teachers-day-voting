"use client";

import { useState } from "react";

interface FacultyAvatarProps {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function FacultyAvatar({
  name,
  url,
  size = "md",
  className = "",
}: FacultyAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sizeClasses = {
    sm: "size-9 text-xs",
    md: "size-12 text-sm",
    lg: "size-16 text-lg",
    xl: "size-20 text-xl",
  }[size];

  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`${sizeClasses} shrink-0 rounded-full object-cover border border-primary/20 bg-muted shadow-2xs ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 rounded-full bg-primary/10 border border-primary/25 text-primary font-bold flex items-center justify-center shadow-2xs select-none ${className}`}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}
