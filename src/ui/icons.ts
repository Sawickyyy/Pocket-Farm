// Ikony narzędzi (SVG) – ostre na każdym ekranie, bez plików.

const svg = (body: string) => `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS = {
  hoe: svg(
    '<path d="M12 40 34 12" stroke="#8a5a2e" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M28 8h14l-4 10H30z" fill="#9aa4ad" stroke="#5c646b" stroke-width="2" stroke-linejoin="round"/>',
  ),
  can: svg(
    '<path d="M10 20h22v16a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="#4ea3dc" stroke="#2c6f9e" stroke-width="2"/>' +
      '<path d="M32 24l10-8" stroke="#2c6f9e" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M14 20c0-6 4-10 7-10s7 4 7 10" fill="none" stroke="#2c6f9e" stroke-width="3"/>' +
      '<circle cx="44" cy="22" r="1.6" fill="#7cc8f5"/><circle cx="42" cy="27" r="1.6" fill="#7cc8f5"/>',
  ),
  sickle: svg(
    '<path d="M14 40l6-8" stroke="#8a5a2e" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M20 32C10 22 16 6 32 6c-8 4-12 12-8 22z" fill="#c9d0d6" stroke="#5c646b" stroke-width="2" stroke-linejoin="round"/>',
  ),
  rod: svg(
    '<path d="M8 42 38 8" stroke="#8a5a2e" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M38 8q6 14 0 26" fill="none" stroke="#dfe6ec" stroke-width="1.5"/>' +
      '<circle cx="38" cy="36" r="4" fill="#e2486a" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="35" r="3.5" fill="#5c646b"/>',
  ),
  hub: svg(
    '<path d="M6 22 24 8l18 14v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="#e8c48a" stroke="#8a6a35" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M4 23 24 6l20 17" fill="none" stroke="#c0503a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<rect x="19" y="28" width="10" height="14" fill="#a8743f"/>',
  ),
} as const;
