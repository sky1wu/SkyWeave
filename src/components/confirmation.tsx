"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export function useConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => () => resolve.current?.(false), []);
  function finish(value: boolean) {
    resolve.current?.(value);
    resolve.current = null;
    setMessage(null);
  }
  function confirm(text: string) {
    if (resolve.current) return Promise.resolve(false);
    previousFocus.current = document.activeElement as HTMLElement;
    return new Promise<boolean>((done) => {
      resolve.current = done;
      setMessage(text);
    });
  }
  const confirmation = message && (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <AlertDialogContent
        finalFocus={() =>
          previousFocus.current?.isConnected ? previousFocus.current : true
        }
        className="max-w-[calc(100vw-32px)] p-5 sm:max-w-sm"
      >
        <AlertDialogHeader className="place-items-start gap-2 text-left">
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-relaxed">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="m-0 flex-row justify-end rounded-none border-0 bg-transparent p-0 pt-2">
          <AlertDialogCancel onClick={() => finish(false)}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => finish(true)}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, confirmation };
}
