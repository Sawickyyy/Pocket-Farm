// Handel z innymi osadami (docs/plan-osada.md §12): karawany przyjeżdżają do działającej faktorii o 10:00 i odjeżdżają
// po 8 h. Oferty losujemy z listy partnera (skup 3–4 towarów, sprzedaż 2–3), handel idzie z magazynu osady
// (ekwipunek gracza) do skarbca (`s.coins`); przy przyjeździe auto-eksport zostawia rezerwę 5 sztuk.

import { QUALITY_MULT, itemKey, parseKey, type Content, type Quality } from '../../../content/content';
import { HOUR_MS } from '../../calendar';
import type { CommandResult } from '../../commands';
import { OK, addItem, countItem, fail, rand, removeKey, stat, type Ctx } from '../../ctx';
import type { Caravan, GameState, TradeOffer } from '../../types';
import { addBudget, chronicle, hasService, specMult } from './common';
import { priceMult } from './events';

// ---------------------------------------------------------------- stałe

/** Przyjazd karawany o 10:00, postój 8 h (odjazd o 18:00). */
export const CARAVAN_HOUR = 10;
export const CARAVAN_STAY_HOURS = 8;
/** Skup: 3–4 towary po cenie bazowej × 1,1–1,5 (× kryzys × bogata karawana × specjalizacja). */
export const BUY_OFFERS_MIN = 3;
export const BUY_OFFERS_MAX = 4;
export const BUY_PRICE_MIN = 1.1;
export const BUY_PRICE_SPREAD = 0.4;
/** Limit skupu: wartość ~60 × (4–12) monet na towar, 1–40 sztuk. */
export const BUY_VALUE = 60;
export const BUY_VALUE_MIN = 4;
export const BUY_VALUE_SPREAD = 8;
export const BUY_QTY_MAX = 40;
/** Sprzedaż: 2–3 towary po cenie bazowej × 1,2–1,6 (× kryzys), 5–20 sztuk. */
export const SELL_OFFERS_MIN = 2;
export const SELL_OFFERS_MAX = 3;
export const SELL_PRICE_MIN = 1.2;
export const SELL_PRICE_SPREAD = 0.4;
export const SELL_QTY_MIN = 5;
export const SELL_QTY_MAX = 20;
/** Auto-eksport zostawia w magazynie tyle sztuk każdego towaru. */
export const EXPORT_RESERVE = 5;

const QUALITIES: readonly Quality[] = [0, 1, 2];

// ---------------------------------------------------------------- zapytania (symulacja + UI)

/** Odstęp karawan w dniach wg najwyższego etapu (0 = brak karawan); specjalizacja handlowa – codziennie. */
export function caravanInterval(s: GameState, c: Content): number {
  const list = c.settlement.caravanInterval;
  const base = list[Math.min(Math.max(0, s.settlement.peakTier), list.length - 1)] ?? 0;
  if (!(base > 0)) return 0;
  return s.settlement.specialization === 'trade' ? 1 : base;
}

/** Czy karawany mogą przyjeżdżać (działająca faktoria z obsadą i etap z karawanami). */
export const caravansActive = (s: GameState, c: Content): boolean => caravanInterval(s, c) > 0 && hasService(s, c, 'trade');

/** Oferta skupu karawany dla przedmiotu (`key` może mieć jakość). */
export function buyOffer(s: GameState, key: string): TradeOffer | undefined {
  const id = parseKey(key).id;
  return s.settlement.caravan?.buys.find((o) => o.item === id);
}

/** Oferta sprzedaży karawany dla przedmiotu. */
export function sellOffer(s: GameState, item: string): TradeOffer | undefined {
  return s.settlement.caravan?.sells.find((o) => o.item === item);
}

/** Kwota za sprzedaż `qty` sztuk klucza `key` po cenie oferty (z mnożnikiem jakości, zaokrąglona). */
export const exportValue = (offer: TradeOffer, key: string, qty: number): number => Math.round(offer.price * QUALITY_MULT[parseKey(key).q] * qty);

/** Ile sztuk auto-eksport sprzedałby teraz danej ofercie (posiadane − rezerwa, do limitu oferty). */
export function autoExportQty(s: GameState, offer: TradeOffer): number {
  const st = s.settlement;
  if (!st.autoExport.includes(offer.item) || st.reserved.includes(offer.item)) return 0;
  return Math.max(0, Math.min(offer.qty, countItem(s, offer.item) - EXPORT_RESERVE));
}

// ---------------------------------------------------------------- losowanie ofert

const randInt = (s: GameState, min: number, max: number): number => min + Math.floor(rand(s) * (max - min + 1));
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** `n` różnych elementów listy w losowej kolejności (częściowe tasowanie Fishera–Yatesa). */
function pickSome<T>(s: GameState, list: readonly T[], n: number): T[] {
  const a = list.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand(s) * (a.length - i));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a.slice(0, k);
}

/**
 * Nowa karawana od losowego partnera (bez zapisu w stanie). Karawana nie sprzedaje towaru, który skupuje
 * (inaczej zakup i odsprzedaż tej samej karawanie dawałyby darmowy zysk).
 */
export function makeCaravan(ctx: Ctx): Caravan | null {
  const { s, c } = ctx;
  const partners = c.settlement.partners;
  if (!partners.length) return null;
  const partner = partners[Math.floor(rand(s) * partners.length)]!;
  const crisis = priceMult(s);
  const buyMult = crisis * s.settlement.caravanBonus * specMult(s, c, 'trade');
  const base = (id: string): number => c.items[id]?.price ?? 0;
  const known = (id: string): boolean => base(id) > 0;

  const buys: TradeOffer[] = [];
  for (const item of pickSome(s, partner.buys.filter(known), randInt(s, BUY_OFFERS_MIN, BUY_OFFERS_MAX))) {
    const price = Math.max(1, Math.round(base(item) * (BUY_PRICE_MIN + rand(s) * BUY_PRICE_SPREAD) * buyMult));
    const qty = clamp(Math.round((BUY_VALUE / price) * (BUY_VALUE_MIN + rand(s) * BUY_VALUE_SPREAD)), 1, BUY_QTY_MAX);
    buys.push({ item, price, qty });
  }
  const sells: TradeOffer[] = [];
  const pool = partner.sells.filter((id) => known(id) && !buys.some((b) => b.item === id));
  for (const item of pickSome(s, pool, randInt(s, SELL_OFFERS_MIN, SELL_OFFERS_MAX))) {
    const price = Math.max(1, Math.round(base(item) * (SELL_PRICE_MIN + rand(s) * SELL_PRICE_SPREAD) * crisis));
    sells.push({ item, price, qty: randInt(s, SELL_QTY_MIN, SELL_QTY_MAX) });
  }
  return { from: partner.id, leavesAt: s.clock.simMs + CARAVAN_STAY_HOURS * HOUR_MS, buys, sells };
}

// ---------------------------------------------------------------- handel

/** Sprzedaż `qty` sztuk klucza karawanie (bez sprawdzeń i bez zdarzenia). Zwraca kwotę. */
function exportKey(ctx: Ctx, offer: TradeOffer, key: string, qty: number): number {
  const coins = exportValue(offer, key, qty);
  removeKey(ctx.s, key, qty);
  ctx.s.coins += coins;
  offer.qty -= qty;
  addBudget(ctx, 'exports', coins);
  stat(ctx, 'coinsEarned', coins);
  return coins;
}

/** Auto-eksport przy przyjeździe: towary z `autoExport` (bez zarezerwowanych), od najniższej jakości. */
export function autoExport(ctx: Ctx, caravan: Caravan): void {
  const { s } = ctx;
  for (const offer of caravan.buys) {
    let left = autoExportQty(s, offer);
    if (left <= 0) continue;
    let qty = 0;
    let coins = 0;
    for (const q of QUALITIES) {
      const key = itemKey(offer.item, q);
      const n = Math.min(left, s.inventory[key] ?? 0);
      if (n <= 0) continue;
      coins += exportKey(ctx, offer, key, n);
      qty += n;
      left -= n;
      if (left <= 0) break;
    }
    if (qty > 0) ctx.bus.emit({ type: 'traded', item: offer.item, qty, coins, dir: 'export' });
  }
}

function arrive(ctx: Ctx, interval: number): void {
  const st = ctx.s.settlement;
  const caravan = makeCaravan(ctx);
  if (!caravan) return;
  st.caravan = caravan;
  st.nextCaravanDay = ctx.cal.day + interval;
  // Premia bogatej karawany zużyta (wydarzenie zdejmuje moduł wydarzeń).
  st.caravanBonus = 1;
  ctx.bus.emit({ type: 'caravan', from: caravan.from });
  chronicle(ctx, 'caravan', { from: caravan.from });
  autoExport(ctx, caravan);
}

/** Co godzinę: przyjazd karawany o 10:00 (oferty, auto-eksport), odjazd o czasie `leavesAt`. */
export function tradeHour(ctx: Ctx, hour: number): void {
  const { s, c } = ctx;
  const st = s.settlement;
  if (st.caravan && s.clock.simMs >= st.caravan.leavesAt) {
    const from = st.caravan.from;
    st.caravan = null;
    ctx.bus.emit({ type: 'caravanLeft', from });
    chronicle(ctx, 'caravanLeft', { from });
  }
  if (hour !== CARAVAN_HOUR || st.caravan) return;
  const interval = caravanInterval(s, c);
  if (interval <= 0 || !hasService(s, c, 'trade')) return;
  const day = ctx.cal.day;
  if (st.nextCaravanDay < 0) st.nextCaravanDay = day;
  if (day < st.nextCaravanDay) return;
  arrive(ctx, interval);
}

const validQty = (qty: number, offer: TradeOffer): boolean => Number.isInteger(qty) && qty >= 1 && qty <= offer.qty;

/** Sprzedaż karawanie `qty` sztuk klucza `key` (cena oferty × jakość). */
export function caravanSell(ctx: Ctx, key: string, qty: number): CommandResult {
  const { s } = ctx;
  if (!s.settlement.caravan) return fail('no-caravan');
  if (typeof key !== 'string') return fail('invalid');
  const offer = buyOffer(s, key);
  if (!offer || !validQty(qty, offer)) return fail('invalid');
  if ((s.inventory[key] ?? 0) < qty) return fail('no-stock');
  const coins = exportKey(ctx, offer, key, qty);
  ctx.bus.emit({ type: 'traded', item: offer.item, qty, coins, dir: 'export' });
  return OK;
}

/** Zakup od karawany `qty` sztuk (zwykła jakość) do magazynu osady. */
export function caravanBuy(ctx: Ctx, item: string, qty: number): CommandResult {
  const { s } = ctx;
  if (!s.settlement.caravan) return fail('no-caravan');
  const offer = sellOffer(s, item);
  if (!offer || !validQty(qty, offer)) return fail('invalid');
  const cost = offer.price * qty;
  if (s.coins < cost) return fail('no-coins');
  s.coins -= cost;
  addItem(s, offer.item, qty);
  offer.qty -= qty;
  addBudget(ctx, 'imports', cost);
  ctx.bus.emit({ type: 'traded', item: offer.item, qty, coins: cost, dir: 'import' });
  return OK;
}

/** Włącza/wyłącza auto-eksport przedmiotu (id bez jakości). */
export function toggleExport(ctx: Ctx, item: string): CommandResult {
  if (typeof item !== 'string' || !ctx.c.items[item]) return fail('invalid');
  const list = ctx.s.settlement.autoExport;
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  else list.push(item);
  return OK;
}
