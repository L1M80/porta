/**
 * Monochrome SVG icons — consistent visual language.
 * All icons accept className and size (default 16px).
 */

interface IconProps {
  size?: number;
  className?: string;
}

const d = (size: number, className: string | undefined, path: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d={path} />
  </svg>
);

// Multi-path helper
const m = (size: number, className: string | undefined, paths: string[]) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {paths.map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);

export const IconPlus = ({ size = 16, className }: IconProps) =>
  m(size, className, ["M12 5v14", "M5 12h14"]);

export const IconSearch = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconMenu = ({ size = 16, className }: IconProps) =>
  m(size, className, ["M4 6h16", "M4 12h16", "M4 18h16"]);

export const IconX = ({ size = 16, className }: IconProps) =>
  m(size, className, ["M18 6 6 18", "m6-12 12 12"]);

export const IconChevron = ({ size = 16, className }: IconProps) =>
  d(size, className, "m6 9 6 6 6-6");

export const IconMore = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
);

export const IconTerminal = ({ size = 16, className }: IconProps) =>
  m(size, className, ["m4 17 6-6-6-6", "M12 19h8"]);

export const IconFile = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
    "M14 2v6h6",
  ]);

export const IconFileSearch = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
    "M14 2v6h6",
    "M9 15h6",
  ]);

export const IconFolder = ({ size = 16, className }: IconProps) =>
  d(
    size,
    className,
    "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z",
  );

export const IconZap = ({ size = 16, className }: IconProps) =>
  d(size, className, "M13 2 3 14h9l-1 8 10-12h-9l1-8z");

export const IconChat = ({ size = 16, className }: IconProps) =>
  d(
    size,
    className,
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  );

export const IconEdit = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
    "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  ]);

/** Spinning loader icon for running threads */
export const IconSpinner = ({ size = 14, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    className={`icon-spin ${className ?? ""}`}
  >
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

export const IconCopy = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    "M8 2h8v4H8z",
  ]);

export const IconCheck = ({ size = 16, className }: IconProps) =>
  d(size, className, "M20 6 9 17l-5-5");

export const IconUndo = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M3 7v6h6",
    "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13",
  ]);

export const IconPaperclip = ({ size = 16, className }: IconProps) =>
  d(
    size,
    className,
    "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  );

export const IconCamera = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
    "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ]);

export const IconMessageCircle = ({ size = 16, className }: IconProps) =>
  d(
    size,
    className,
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  );

export const IconAlertTriangle = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z",
    "M12 9v4",
    "M12 17h.01",
  ]);

export const IconLock = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const IconFileText = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
    "M14 2v6h6",
    "M16 13H8",
    "M16 17H8",
    "M10 9H8",
  ]);

export const IconPencil = ({ size = 16, className }: IconProps) =>
  d(size, className, "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z");

export const IconEye = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconList = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M8 6h13",
    "M8 12h13",
    "M8 18h13",
    "M3 6h.01",
    "M3 12h.01",
    "M3 18h.01",
  ]);

export const IconGear = ({ size = 16, className }: IconProps) =>
  m(size, className, [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ]);

export const IconChevronLeft = ({ size = 16, className }: IconProps) =>
  d(size, className, "m15 18-6-6 6-6");
