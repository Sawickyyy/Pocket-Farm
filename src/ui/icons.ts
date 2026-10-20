// Proste ikony SVG dla interfejsu HTML (ostre na każdym ekranie, bez plików).

import type { CropId, ToolId, UpgradeId } from '../game/content';

const svg = (body: string) => `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS: Record<ToolId | 'shop', string> = {
  hoe: svg(
    '<path d="M12 40 34 12" stroke="#8a5a2e" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M28 8h14l-4 10H30z" fill="#9aa4ad" stroke="#5c646b" stroke-width="2" stroke-linejoin="round"/>',
  ),
  seeds: svg(
    '<path d="M14 18c0-4 4-6 10-6s10 2 10 6l2 20c0 3-5 5-12 5s-12-2-12-5z" fill="#d8b77a" stroke="#8a6a35" stroke-width="2"/>' +
      '<path d="M18 13l3-5h6l3 5" fill="none" stroke="#8a6a35" stroke-width="2"/>' +
      '<path d="M24 34c0-6 3-9 7-10-1 5-3 8-7 10zM24 34c0-5-3-8-6-9 0 4 2 7 6 9z" fill="#5fae3a"/>',
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
  shop: svg(
    '<path d="M8 20h32v20H8z" fill="#f3e2c0" stroke="#8a6a35" stroke-width="2"/>' +
      '<path d="M6 20l4-10h28l4 10z" fill="#e2486a" stroke="#9c2a43" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M14 10l-2 10M24 10v10M34 10l2 10" stroke="#fff" stroke-width="2"/>' +
      '<rect x="19" y="28" width="10" height="12" fill="#a8743f"/>',
  ),
};

export const CROP_ICONS: Record<CropId, string> = {
  radish: svg(
    '<path d="M24 22c-4-8-10-10-12-8 2 2 6 6 12 8zM24 22c4-8 10-10 12-8-2 2-6 6-12 8zM24 22V8" stroke="#3f8a2a" stroke-width="3" fill="#5fae3a"/>' +
      '<circle cx="24" cy="30" r="10" fill="#e2486a"/><path d="M24 40v5" stroke="#f6f0e8" stroke-width="3" stroke-linecap="round"/>',
  ),
  carrot: svg(
    '<path d="M24 16 18 6M24 16l6-10M24 16V4" stroke="#4f9e2f" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M15 18h18L24 46z" fill="#f08a24" stroke="#c0650e" stroke-width="2" stroke-linejoin="round"/>',
  ),
  wheat: svg(
    '<path d="M24 46V10" stroke="#c99a2e" stroke-width="3"/>' +
      [12, 19, 26, 33].map((y) => `<ellipse cx="19" cy="${y}" rx="4" ry="6" fill="#f0cc5a" transform="rotate(-30 19 ${y})"/><ellipse cx="29" cy="${y}" rx="4" ry="6" fill="#e4b844" transform="rotate(30 29 ${y})"/>`).join(''),
  ),
  pumpkin: svg(
    '<rect x="22" y="6" width="5" height="9" rx="2" fill="#5a7a2a"/>' +
      '<ellipse cx="16" cy="29" rx="10" ry="13" fill="#d8661a"/><ellipse cx="32" cy="29" rx="10" ry="13" fill="#d8661a"/><ellipse cx="24" cy="29" rx="10" ry="14" fill="#ef8326"/>',
  ),
};

export const UPGRADE_ICONS: Record<UpgradeId, string> = {
  fertilizer: svg(
    '<path d="M12 14h24l-2 30H14z" fill="#7c5128" stroke="#4a2c15" stroke-width="2"/>' +
      '<path d="M24 34c0-8 4-12 9-13-1 7-4 11-9 13z" fill="#8fd16a"/><rect x="14" y="8" width="20" height="6" rx="2" fill="#a8743f"/>',
  ),
  stall: TOOL_ICONS.shop,
  sprinkler: svg(
    '<path d="M24 44V22" stroke="#5c646b" stroke-width="4"/><circle cx="24" cy="20" r="5" fill="#9aa4ad"/>' +
      '<path d="M10 12q14-10 28 0" fill="none" stroke="#4ea3dc" stroke-width="3" stroke-dasharray="3 4"/>' +
      '<path d="M6 20q18-14 36 0" fill="none" stroke="#7cc8f5" stroke-width="3" stroke-dasharray="3 4"/>',
  ),
};
