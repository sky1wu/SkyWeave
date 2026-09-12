"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

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
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(defaultValue),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 260,
    height: 300,
  });
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const selected = value ?? local;
  const searchText = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) =>
    `${option.label} ${option.keywords ?? ""}`
      .toLocaleLowerCase()
      .includes(searchText),
  );
  const choices =
    allowCustom &&
    searchText &&
    !options.some((o) => o.label.toLocaleLowerCase() === searchText)
      ? [...filtered, { value: query.trim(), label: `使用“${query.trim()}”` }]
      : filtered;
  const index = Math.max(0, Math.min(active, choices.length - 1));
  const measure = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport,
      topEdge = viewport?.offsetTop ?? 0,
      bottomEdge = topEdge + (viewport?.height ?? innerHeight);
    const width = Math.min(Math.max(rect.width, 260), innerWidth - 24),
      below = bottomEdge - rect.bottom - 12,
      above = rect.top - topEdge - 12;
    const upward = below < 210 && above > below,
      height = Math.min(320, Math.max(120, upward ? above : below));
    setPosition({
      left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
      top: upward
        ? Math.max(topEdge + 12, rect.top - height - 6)
        : rect.bottom + 6,
      width,
      height,
    });
  }, []);
  function show() {
    measure();
    setPortal(trigger.current?.closest<HTMLElement>(".modal") ?? document.body);
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === selected),
      ),
    );
    setOpen(true);
  }
  function choose(option: SelectOption) {
    setLocal(option.value);
    onChange?.(option.value);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    const focus = requestAnimationFrame(() =>
      search.current?.focus({ preventScroll: true }),
    );
    let resize = 0;
    const update = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        popup.current?.contains(event.target)
      )
        return;
      cancelAnimationFrame(resize);
      resize = requestAnimationFrame(measure);
    };
    const outside = (event: PointerEvent) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(focus);
      cancelAnimationFrame(resize);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, measure]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${index}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [id, index, open]);
  return (
    <div className={`searchable-select ${className}`}>
      {!hideLabel && <label htmlFor={id}>{label}</label>}
      {name && <input type="hidden" name={name} value={selected} />}
      <button
        id={id}
        ref={trigger}
        type="button"
        role="combobox"
        className="select-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span>
          {options.find((o) => o.value === selected)?.label ||
            selected ||
            placeholder}
        </span>
        <ChevronDown size={14} />
      </button>
      {open &&
        portal &&
        createPortal(
          <div
            ref={popup}
            className="select-popup"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) =>
                  choices.length
                    ? (i +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        choices.length) %
                      choices.length
                    : 0,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (choices[index]) choose(choices[index]);
              } else if (event.key === "Tab") {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              }
            }}
          >
            <div className="select-search">
              <Search size={15} />
              <input
                ref={search}
                aria-label={`搜索${label}`}
                aria-controls={`${id}-list`}
                aria-activedescendant={
                  choices.length ? `${id}-option-${index}` : undefined
                }
                autoComplete="off"
                maxLength={40}
                placeholder={allowCustom ? "搜索或输入" : "搜索"}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            </div>
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label={`${label}选项`}
              className="select-options"
            >
              {choices.map((option, i) => (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${id}-option-${i}`}
                  key={option.value}
                  aria-selected={selected === option.value}
                  className={i === index ? "highlighted" : ""}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  {selected === option.value && <Check size={14} />}
                </button>
              ))}
              {!choices.length && <p className="muted">没有匹配项</p>}
            </div>
          </div>,
          portal,
        )}
    </div>
  );
}
