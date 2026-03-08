/**
 * ErrorBanner – dismissible inline error message.
 */

"use client";

import React from "react";

interface ErrorBannerProps {
  message: string | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-danger"
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-danger hover:opacity-70 focus:outline-none"
          aria-label="Dismiss error"
        >
          ✕
        </button>
      )}
    </div>
  );
}
