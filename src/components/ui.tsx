"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { X, Navigation2 } from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="SkyWeave">
      <span className="brand-icon">
        <Navigation2 size={29} strokeWidth={1.8} />
      </span>
      <span>SkyWeave</span>
    </Link>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex="0"]',
          ) ?? []),
        ].filter((e) => !e.hasAttribute("disabled"));
        if (!elements.length) return;
        const first = elements[0],
          last = elements.at(-1)!;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="flex items-center justify-between gap-4">
          <h2>{title}</h2>
          <button className="btn mb-5" aria-label="关闭" onClick={close}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
