/**
 * @file Icons.jsx
 * @description Reusable SVG iconography components for the Web3 Battle Arena UI.
 */

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 3h7l4.2 7.4L20.4 3H27l-7.6 12.4L28 29h-7.1l-4.6-8.2L11.4 29H5l8-13.2L5 3Z" />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function GamepadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 7h9A4.5 4.5 0 0 1 21 11.5v3a3.5 3.5 0 0 1-6.3 2.1l-.7-.9h-4l-.7.9A3.5 3.5 0 0 1 3 14.5v-3A4.5 4.5 0 0 1 7.5 7Zm.5 3v1.6H6.4v1.8H8V15h1.8v-1.6h1.6v-1.8H9.8V10H8Zm7.4.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm2.6 2.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.4L3 16.7V21h4.3v-2.2H9.5v-2.2h2.2l1-1A6.5 6.5 0 1 0 14.5 3Zm2 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
    </svg>
  );
}

export function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v3h3v3c0 3-2.2 5.4-5 5.8V18h3v3H6v-3h3v-3.2C6.2 14.4 4 12 4 9V6h3V3Zm0 5H6v1c0 1.8.9 3.3 2.4 4.1L8 8H7Zm10 0h-1l-.4 5.1C17.1 12.3 18 10.8 18 9V8h-1Z" />
    </svg>
  );
}

export function ChainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.6 14.4a1 1 0 0 1 0-1.4l3.4-3.4a1 1 0 0 1 1.4 1.4L11 14.4a1 1 0 0 1-1.4 0Zm-2.5.3a4 4 0 0 1 0-5.7l2.4-2.4a4 4 0 0 1 5.7 0 1 1 0 0 1-1.4 1.5 2 2 0 0 0-2.9 0L8.5 10.5a2 2 0 0 0 0 2.9 1 1 0 1 1-1.4 1.4Zm9.8-5.4a1 1 0 0 1 1.4 0 4 4 0 0 1 0 5.7l-2.4 2.4a4 4 0 0 1-5.7 0 1 1 0 0 1 1.4-1.5 2 2 0 0 0 2.9 0l2.4-2.4a2 2 0 0 0 0-2.9 1 1 0 0 1 0-1.3Z" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z" />
    </svg>
  );
}
