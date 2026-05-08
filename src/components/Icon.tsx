type IconProps = {
  className?: string;
  size?: number;
  strokeWidth?: number;
};

const base = (
  size = 20,
  className?: string,
  strokeWidth = 1.75
) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

export function IconHome({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function IconClock({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconCamera({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function IconReceipt({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

export function IconMore({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </svg>
  );
}

export function IconSettings({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 5l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function IconTarget({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

export function IconTag({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
      <circle cx="7.5" cy="7.5" r="1.25" />
    </svg>
  );
}

export function IconList({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="0.9" />
      <circle cx="4" cy="12" r="0.9" />
      <circle cx="4" cy="18" r="0.9" />
    </svg>
  );
}

export function IconChevronLeft({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconBell({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconSpreadsheet({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9.5h17M3.5 15h17M9 3.5v17M15 3.5v17" />
    </svg>
  );
}

export function IconDocument({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconBraces({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M9 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2" />
      <path d="M15 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}

export function IconArrowLeft({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function IconPlus({ className, size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, className, strokeWidth)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

