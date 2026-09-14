"use client";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./ui/combobox";

export interface SelectOption {
  value: string;
  label: string;
  keywords?: string;
}
export function SearchableSelect({
  label,
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  placeholder = "请选择",
  allowCustom = false,
  hideLabel = false,
  className = "",
}: {
  label: string;
  name?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId(),
    anchor = useRef<HTMLButtonElement>(null);
  const [local, setLocal] = useState(defaultValue),
    [query, setQuery] = useState(""),
    [open, setOpen] = useState(false);
  const selected = value ?? local;
  const selectedLabel =
    options.find((o) => o.value === selected)?.label || selected || placeholder;
  const search = query.trim().toLocaleLowerCase();
  const filtered = options.filter((o) =>
    `${o.label} ${o.keywords ?? ""}`.toLocaleLowerCase().includes(search),
  );
  const choices =
    allowCustom &&
    search &&
    !options.some((o) => o.label.toLocaleLowerCase() === search)
      ? [...filtered, { value: query.trim(), label: `使用“${query.trim()}”` }]
      : filtered;
  return (
    <div className={cn("searchable-select grid min-w-0 gap-2", className)}>
      {!hideLabel && <Label htmlFor={id}>{label}</Label>}
      <Combobox
        open={open}
        items={choices.map((o) => o.value)}
        value={selected}
        name={name}
        itemToStringLabel={(value) =>
          options.find((o) => o.value === value)?.label ?? value
        }
        itemToStringValue={(value) => value}
        filter={null}
        autoHighlight
        inputValue={query}
        onInputValueChange={setQuery}
        onOpenChange={(open) => {
          setOpen(open);
          if (open) setQuery("");
        }}
        onValueChange={(option) => {
          if (option !== null) {
            setLocal(option);
            onChange?.(option);
          }
        }}
      >
        <ComboboxTrigger
          ref={anchor}
          id={id}
          render={<Button variant="outline" />}
          role="combobox"
          aria-label={label}
          onKeyDown={(event) => {
            // Focus may still be on the trigger while the popup is opening.
            if (
              event.key === "Escape" &&
              open &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          className={cn(
            "select-trigger h-9 w-full min-w-0 justify-between px-3 font-normal",
            hideLabel && "gap-1 px-2 text-xs",
          )}
        >
          <span className="truncate">{selectedLabel}</span>
        </ComboboxTrigger>
        <ComboboxContent
          anchor={anchor}
          aria-label={`${label}选择`}
          className="sw-combobox w-[max(var(--anchor-width),260px)] max-w-[min(var(--available-width),calc(100vw-24px))] data-open:animate-none data-closed:hidden data-closed:animate-none"
        >
          <ComboboxInput
            showTrigger={false}
            aria-label={`搜索${label}`}
            placeholder={allowCustom ? "搜索或输入" : "搜索"}
            maxLength={40}
            autoComplete="off"
            className="h-9"
          />
          <ComboboxEmpty className="p-4 text-sm text-muted-foreground">
            没有匹配项
          </ComboboxEmpty>
          <ComboboxList aria-label={`${label}选项`} className="max-h-64 p-1">
            {(option: string) => (
              <ComboboxItem
                key={option}
                value={option}
                className="min-h-9 px-3 pr-8 text-[13px]"
              >
                {choices.find((o) => o.value === option)?.label ?? option}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
