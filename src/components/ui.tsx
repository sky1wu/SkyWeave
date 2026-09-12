"use client";
import Link from "next/link";
import { Navigation2, X } from "lucide-react";
import { useRef } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="SkyWeave">
      <span className="brand-icon">
        <Navigation2 size={27} strokeWidth={1.8} />
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
  const mobile = useMediaQuery("(max-width: 600px)");
  const previousFocus = useRef<HTMLElement | null>(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement),
  );
  const returnFocus = () =>
    previousFocus.current?.isConnected ? previousFocus.current : true;
  if (mobile)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          finalFocus={returnFocus}
          aria-describedby={undefined}
          className="sw-modal sw-mobile-sheet max-h-[94dvh] gap-0 rounded-t-xl"
        >
          <SheetHeader className="sw-modal-header flex-row items-center justify-between gap-4 border-b px-5 py-4">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetClose
              render={<Button variant="ghost" size="icon" aria-label="关闭" />}
            >
              <X className="size-4" />
            </SheetClose>
          </SheetHeader>
          <div className="sw-modal-body min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={returnFocus}
        aria-describedby={undefined}
        className="sw-modal flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]"
      >
        <DialogHeader className="sw-modal-header flex-row items-center justify-between gap-4 border-b px-6 py-4">
          <DialogTitle className="text-lg font-semibold leading-normal">
            {title}
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label="关闭" />}
          >
            <X className="size-4" />
          </DialogClose>
        </DialogHeader>
        <div className="sw-modal-body min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
