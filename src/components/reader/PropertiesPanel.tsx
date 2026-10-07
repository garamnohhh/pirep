import { useRef, useState } from "react";
import { useStore } from "../../store";
import { propertySuggestions } from "../../lib/propertySuggestions";

interface Field {
  key: string;
  rawKey: string;
  value: string;
}

function parseAll(fm: string): Field[] {
  return fm.split("\n").flatMap((line) => {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    return m ? [{ key: m[1].toLowerCase(), rawKey: m[1], value: m[2].trim() }] : [];
  });
}

const parseTags = (v: string): string[] =>
  !v
    ? []
    : v
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

const serializeTags = (tags: string[]) =>
  tags.length === 0 ? "" : `[${tags.join(", ")}]`;

const isPinned = (v: string) => v === "true" || v === "yes";

export function PropertiesPanel({
  frontmatter,
  onFrontmatterChange,
}: {
  frontmatter: string | null;
  onFrontmatterChange?: (newFm: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showAddInput, setShowAddInput] = useState(false);
  const [addKeyInput, setAddKeyInput] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const baseKeys = useStore((s) => s.frontmatterKeys);
  const statusRef = useRef<HTMLInputElement>(null);

  if (!frontmatter) return null;
  const fields = parseAll(frontmatter);
  if (fields.length === 0) return null;

  const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  const existingKeys = new Set(fields.map((f) => f.key));
  const suggestions = propertySuggestions(baseKeys, [...existingKeys], addKeyInput);
  const choices = [...suggestions.pirep, ...suggestions.base, ...(suggestions.create ? [{ key: suggestions.create }] : [])];
  const tagList = parseTags(byKey.tags ?? "");
  const pinned = isPinned(byKey.pinned ?? "");

  function updateField(key: string, value: string) {
    if (!onFrontmatterChange) return;
    const lines = frontmatter!.split("\n");
    const idx = lines.findIndex((l) => l.match(new RegExp(`^${key}:`, "i")));
    const newLine = value !== "" ? `${key}: ${value}` : null;
    let newLines: string[];
    if (idx >= 0) {
      newLines = newLine
        ? lines.map((l, i) => (i === idx ? newLine : l))
        : lines.filter((_, i) => i !== idx);
    } else {
      newLines = newLine ? [...lines.filter(Boolean), newLine] : lines;
    }
    onFrontmatterChange(newLines.filter(Boolean).join("\n"));
  }

  function insertField(key: string, value: string) {
    if (!onFrontmatterChange) return;
    onFrontmatterChange(
      [...frontmatter!.split("\n").filter(Boolean), `${key}: ${value}`].join("\n"),
    );
  }

  function removeField(key: string) {
    updateField(key, "");
  }

  function saveStatus(value: string) {
    updateField("status", value.trim());
    setEditingStatus(false);
  }

  function removeTag(tag: string) {
    updateField("tags", serializeTags(tagList.filter((t) => t !== tag)));
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || tagList.includes(trimmed)) return;
    updateField("tags", serializeTags([...tagList, trimmed]));
    setTagInput("");
  }

  function handleAddKey(input: string) {
    const key = input.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key || existingKeys.has(key)) return;
    setShowAddInput(false);
    setAddKeyInput("");
    if (key === "status") {
      insertField("status", "");
      setEditingStatus(true);
    } else if (key === "tags") {
      insertField("tags", "");
    } else if (key === "pinned") {
      insertField("pinned", "false");
    } else if (key === "created" || key === "updated") {
      insertField(key, new Date().toISOString().slice(0, 10));
    } else {
      insertField(key, "");
    }
  }

  return (
    <div className="mb-6 overflow-hidden border border-line bg-surface text-[12.5px]">
      {/* header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[34px] w-full items-center gap-2 px-3 text-left"
      >
        <span className={`text-mid transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted">
          Properties
        </span>
        {!open && (
          <span className="ml-1.5 flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
            {byKey.status && (
              <span className="flex shrink-0 items-center gap-1.5 border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-ink">
                <span className="h-[5px] w-[5px] bg-green" />
                {byKey.status}
              </span>
            )}
            {tagList.length > 0 && (
              <span className="min-w-0 truncate text-muted">
                {tagList.map((t) => `#${t}`).join(" ")}
              </span>
            )}
            {(byKey.updated || byKey.created) && (
              <span className="shrink-0 tabular-nums text-mid">
                {byKey.updated || byKey.created}
              </span>
            )}
            {pinned && <PinIcon />}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col border-t border-line">
          {fields.map(({ key, value }) => {
            // status
            if (key === "status")
              return (
                <Row
                  key={key}
                  label={key}
                  onRemove={onFrontmatterChange ? () => removeField(key) : undefined}
                >
                  {editingStatus ? (
                    <input
                      ref={statusRef}
                      autoFocus
                      defaultValue={value}
                      onBlur={(e) => saveStatus(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          saveStatus((e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setEditingStatus(false);
                        e.stopPropagation();
                      }}
                      className="w-full rounded border border-line bg-paper px-2 py-0.5 text-ink outline-none focus:border-gold"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        if (onFrontmatterChange) {
                          setEditingStatus(true);
                          setTimeout(() => statusRef.current?.select(), 0);
                        }
                      }}
                      className={`flex items-center gap-1.5 border border-line bg-surface px-2 py-0.5 text-ink ${onFrontmatterChange ? "hover:border-mid" : ""}`}
                    >
                      {value ? (
                        <>
                          <span className="h-1.5 w-1.5 bg-green" />
                          {value}
                        </>
                      ) : (
                        <span className="text-mid">click to set…</span>
                      )}
                    </button>
                  )}
                </Row>
              );

            // tags
            if (key === "tags")
              return (
                <Row
                  key={key}
                  label={key}
                  onRemove={onFrontmatterChange ? () => removeField(key) : undefined}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tagList.map((t) => (
                      <span
                        key={t}
                        className="flex items-center gap-1 border border-line bg-tertiary px-2 py-0.5 text-slate"
                      >
                        {t}
                        {onFrontmatterChange && (
                          <button
                            onClick={() => removeTag(t)}
                            className="text-mid hover:text-ink"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {onFrontmatterChange && (
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addTag(tagInput);
                          }
                          e.stopPropagation();
                        }}
                        onBlur={() => {
                          if (tagInput.trim()) addTag(tagInput);
                        }}
                        placeholder="+ tag"
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-muted outline-none placeholder:text-mid hover:border-line focus:border-line focus:text-ink"
                      />
                    )}
                  </div>
                </Row>
              );

            // pinned
            if (key === "pinned")
              return (
                <Row
                  key={key}
                  label={key}
                  onRemove={onFrontmatterChange ? () => removeField(key) : undefined}
                >
                  <button
                    onClick={
                      onFrontmatterChange
                        ? () => updateField("pinned", pinned ? "false" : "true")
                        : undefined
                    }
                    className={`flex items-center gap-1.5 ${onFrontmatterChange ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span
                      className={`inline-flex h-4 w-7 items-center border transition-colors ${pinned ? "border-[var(--color-gold)] bg-gold" : "border-line bg-transparent"}`}
                    >
                      <span
                        className={`h-3 w-3 translate-x-0.5 transition-transform ${pinned ? "translate-x-3.5 bg-[var(--color-on-accent)]" : "bg-mid"}`}
                      />
                    </span>
                    <span className="text-slate">{pinned ? "true" : "false"}</span>
                  </button>
                </Row>
              );

            // date fields
            if (key === "created" || key === "updated")
              return (
                <Row
                  key={key}
                  label={key}
                  onRemove={onFrontmatterChange ? () => removeField(key) : undefined}
                >
                  {onFrontmatterChange ? (
                    <input
                      type="date"
                      value={value}
                      onChange={(e) => updateField(key, e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="rounded border border-transparent bg-transparent px-1 py-0.5 tabular-nums text-ink outline-none hover:border-line focus:border-line"
                    />
                  ) : value ? (
                    <span className="tabular-nums text-ink">{value}</span>
                  ) : (
                    <Empty />
                  )}
                </Row>
              );

            // arbitrary field
            return (
              <Row
                key={key}
                label={key}
                onRemove={onFrontmatterChange ? () => removeField(key) : undefined}
              >
                <InlineText
                  value={value}
                  editable={!!onFrontmatterChange}
                  onSave={(v) => updateField(key, v)}
                />
              </Row>
            );
          })}

          {/* add property */}
          {onFrontmatterChange && (
            <div className="border-t border-line px-3 py-1.5">
              {showAddInput ? (
                <div>
                <input
                  autoFocus
                  value={addKeyInput}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="property-key-options"
                  aria-autocomplete="list"
                  onChange={(e) => { setAddKeyInput(e.target.value); setActiveSuggestion(0); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (choices[activeSuggestion]) handleAddKey(choices[activeSuggestion].key);
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggestion((i) => Math.max(0, Math.min(choices.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
                    }
                    if (e.key === "Escape") {
                      setShowAddInput(false);
                      setAddKeyInput("");
                    }
                    e.stopPropagation();
                  }}
                  placeholder="Search or create a property…"
                  className="w-full rounded border border-line bg-paper px-2 py-0.5 text-ink outline-none focus:border-gold"
                />
                <div id="property-key-options" role="listbox" className="mt-1 max-h-56 w-full overflow-y-auto border border-line bg-surface">
                  {choices.length === 0 && <div className="px-2 py-1.5 text-muted">No properties</div>}
                  {suggestions.pirep.length > 0 && <SuggestionGroup label="pirep" keys={suggestions.pirep} offset={0} active={activeSuggestion} choose={handleAddKey} />}
                  {suggestions.base.length > 0 && <SuggestionGroup label="In this Base" keys={suggestions.base} offset={suggestions.pirep.length} active={activeSuggestion} choose={handleAddKey} />}
                  {suggestions.create && <button type="button" role="option" aria-selected={activeSuggestion === choices.length - 1} onMouseDown={(e) => e.preventDefault()} onClick={() => handleAddKey(suggestions.create!)} className={`block w-full px-2 py-1.5 text-left ${activeSuggestion === choices.length - 1 ? "bg-tertiary text-ink" : "text-muted"}`}>+ Create "{suggestions.create}"</button>}
                </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddInput(true)}
                  className="text-muted hover:text-ink"
                >
                  + Add property
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionGroup({ label, keys, offset, active, choose }: { label: string; keys: { key: string; count?: number }[]; offset: number; active: number; choose: (key: string) => void }) {
  return <div><div className="px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-mid">{label}</div>{keys.map(({ key, count }, i) => <button type="button" role="option" aria-selected={active === offset + i} key={key} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(key)} className={`flex w-full items-center px-2 py-1 text-left ${active === offset + i ? "bg-tertiary text-ink" : "text-muted"}`}><span>{key}</span>{count !== undefined && <span className="ml-auto font-mono text-[10px] text-mid">{count}</span>}</button>)}</div>;
}

function InlineText({
  value,
  editable,
  onSave,
}: {
  value: string;
  editable: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editable) return value ? <span className="text-ink">{value}</span> : <Empty />;
  if (editing)
    return (
      <input
        autoFocus
        defaultValue={value}
        onBlur={(e) => {
          onSave(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSave((e.target as HTMLInputElement).value);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        className="w-full rounded border border-line bg-paper px-2 py-0.5 text-ink outline-none focus:border-gold"
      />
    );
  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center border border-line bg-surface px-2 py-0.5 text-left text-ink hover:border-mid"
    >
      {value || <span className="text-mid">click to set…</span>}
    </button>
  );
}

function Row({
  label,
  children,
  onRemove,
}: {
  label: string;
  children: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex min-h-[32px] items-center border-t border-line px-3 py-1 first:border-t-0">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-2 hidden text-mid hover:text-ink group-hover:block"
        >
          ×
        </button>
      )}
    </div>
  );
}

const Empty = () => <span className="text-mid">—</span>;

function PinIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--color-gold)"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-auto shrink-0"
    >
      <path d="M5 2.5h6l-.6 4 2.1 2.2H3.5L5.6 6.5z" />
      <path d="M8 10.7V13.5" />
    </svg>
  );
}
