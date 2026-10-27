// Small segmented control ("Files | Text | Topic"), the same visual
// language as the drawer's size switch and the pane's Live | Raw toggle.

export interface Segment<T extends string> {
  id: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Segment<T>[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-line p-[2px] text-[12px]">
      {options.map((o) => (
        <button
          key={o.id}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`rounded-[4px] px-2.5 py-[3px] transition-colors disabled:opacity-30 ${
            o.id === value ? "bg-btn text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
