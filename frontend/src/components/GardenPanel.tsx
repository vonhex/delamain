// His garden: real plants in three settings (a south windowsill and a grow-light shelf indoors, a small
// greenhouse, raised beds outdoors) that live in real time under the real sky over home. Plants come up,
// grow, flower, fruit, go dormant, wilt and die by their real needs; a cat comes and goes; and Delamain
// appears only while he is actually there, walking to whatever he is tending.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { render, W, H, SPOTS, BENCH_STAND, BED_STAND, POND_STAND, TALK_STAND, GUEST_AT, GUEST_POND, TREE_STAND, STUDY_DESK, STUDY_STAND, BENCH_SEAT, LADDER_X, LOFT_Y, OFFICE_SEAT, ARMCHAIR, FIELD_GATE, DOOR_IN, DOOR_OUT, SCARECROW, WOODPILE, SNOWMAN_AT, FIRE_AT, TELESCOPE, TANK_STAND, type PWorld, type PField, type Design, type Upkeep } from './gardenPixels';
import { X, Sprout, Maximize2, Minimize2, Send, Volume2, VolumeX, History } from 'lucide-react';
import { useGardenSound } from './gardenSound';

type Spot = {
  id: number; place: 'window' | 'shelf' | 'greenhouse' | 'outdoors'; temp: number; light: number; daily_light: number;
  species: string | null; name?: string | null; stage: string; water?: number; health?: number; wants_water?: number;
  dry?: boolean; needs_light?: number; dormant?: boolean; struggle?: string[]; planted?: number; harvests?: number;
  form?: string; petal?: string; centre?: string; fruit?: string | null; note?: string;
};
type Step = { do: string; spot: number; text: string; at: number };
type Garden = {
  enabled: boolean;
  weather: { temp: number; rain: number; snow: number; cloud: number; code: number; is_day: boolean; real: boolean;
    wind?: number; gust?: number; wind_dir?: number; gust_tomorrow?: number | null; low_tonight?: number | null; high_tomorrow?: number | null; snow_tomorrow?: number };
  daylight: number; units: string; spots: Spot[]; grow_light: boolean;
  cat: { name?: string; here: boolean; where?: string; doing?: string };
  here: boolean; visit: { since: number; until: number; steps: Step[]; noticed?: string } | null;
  last_visit: number; log: { t: number; who: string; text: string }[]; hour: number;
  asleep?: boolean;
  guest?: { name: string; kind: string; about: string; says: string; gift?: string | null; message?: string | null; reply?: string;
    since?: number; until?: number; steps?: { do: string; spot: number; at: number }[]; talk?: { who: string; text: string; t: number }[];
    with?: { name: string; kind: string; about: string; says: string; steps?: { do: string; spot: number; at: number }[] } } | null;
  season?: string; season_progress?: number; year?: { first_frost?: string; first_snow?: string; season?: string };
  design?: Partial<Design>; upkeep?: Partial<Upkeep>; chores?: Record<string, number>;
  seeds?: Record<string, { n: number; gen: number; from?: string | null; cutting?: boolean }>;
  tree?: { species: string; planted: number; name?: string | null; size: number; note: string } | null;
  room?: { books: { title: string; domain?: string }[]; pins: { title: string; colours: number[][] }[]; desk: boolean; therapy: boolean };
  named_fish?: Record<string, { name: string; cm: number }>; diary_days?: number; postcards?: string[];
  life?: { what: string; where: string; doing: string; screen?: string };
  pond?: { ice: number; water_t: number; lure: boolean; caught: { t: number; species: string; cm: number }[]; best: Record<string, number>; total: number };
  visitors?: { name: string; kind: string; about: string; visits: number; left: boolean; last: number; letter: boolean; talk: { date: string; says: string; reply?: string }[] }[];
  sent?: { t: number; text: string; by?: string; delivered?: number | null; visitor?: string | null; reply?: string | null }[];
  gifts?: string[];
  field?: PField & { water: number; struggle: string[]; sown: number; gen: number; wants_water?: number | null; note?: string | null;
    harvests: { date: string; crop: string; amount: number; unit: string }[]; crops: Record<string, string>; last_crop?: string | null };
  pantry?: Record<string, number>; wood?: number; stove_lit?: boolean; snowman?: { size: number; name?: string } | null;
  firepit?: boolean; feeder_fill?: number; sketches?: { t: number; what: string }[];
  money?: number; outfit?: Record<string, string>; owned?: string[];
  ledger?: { t: number; in?: number; out?: number; what: string }[];
  aquarium?: { fish: { species: string; cm: number; name?: string; health?: number; t: number }[]; clean: number; fed: number };
};

export { Sprout as GardenIcon };

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const deg = (c: number, units: string) => (units === 'metric' ? `${Math.round(c)}°C` : `${Math.round(c * 9 / 5 + 32)}°F`);
const STAGE: Record<string, string> = {
  seed: 'sown, not up yet', sprout: 'just come up', young: 'growing', mature: 'grown', bloom: 'flowering', fruit: 'fruiting',
  spent: 'gone to seed', dead: 'dead', empty: 'empty',
};
const PLACE: Record<string, string> = { window: 'South windowsill', shelf: 'Grow-light shelf', greenhouse: 'Greenhouse', outdoors: 'Outdoor beds' };

function PixelScene({ g, big = false, capture }: { g: Garden; big?: boolean; capture?: MutableRefObject<HTMLCanvasElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (capture) capture.current = ref.current; });
  const gRef = useRef(g);
  gRef.current = g;
  const pos = useRef<{ x: number; y: number; facing: number; dist: number } | null>(null);
  const gpos = useRef<{ x: number; y: number; facing: number; dist: number; name: string } | null>(null);
  const gpos2 = useRef<{ x: number; y: number; facing: number; dist: number; name: string } | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    // one step of walking toward a target; returns whether still walking
    const walk = (p: { x: number; y: number; facing: number; dist: number }, tx: number, ty: number, speed: number) => {
      const dx = tx - p.x, dy = ty - p.y;
      if (Math.abs(dx) <= 0.6 && Math.abs(dy) <= 0.6) return false;
      const d = Math.hypot(dx, dy), step = Math.min(d, speed);
      p.x += (dx / d) * step; p.y += (dy / d) * step; p.dist += step;
      if (Math.abs(dx) > 0.6) p.facing = dx > 0 ? 1 : -1;
      return true;
    };
    const rnd = (at: number) => { const h = Math.sin(at * 12.9898) * 43758.5453; return h - Math.floor(h); };
    // between the house and the attic he goes by the ladder: the next point to make for, and whether it is a climb
    const viaLadder = (p: { x: number; y: number }, tx: number, ty: number) => {
      const up = p.y < 125, wantUp = ty < 125;
      if (up === wantUp) return { x: tx, y: ty, climb: false };
      if (Math.abs(p.x - LADDER_X) > 0.6) return { x: LADDER_X, y: up ? LOFT_Y : 157, climb: false };
      return { x: LADDER_X, y: wantUp ? LOFT_Y : 157, climb: true };
    };
    // into the field and out of it he goes by the gap between the pine and the pond (not across the water)
    const inField = (y: number) => y < 146;
    // and in and out of the house by the front door, down the ladder first from the attic
    const indoors = (x: number, y: number) => x < 81 || y < 125;
    const at = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) <= 0.6 && Math.abs(p.y - q.y) <= 0.6;
    const route = (p: { x: number; y: number }, tx: number, ty: number): { x: number; y: number; climb: boolean } => {
      const pIn = indoors(p.x, p.y), tIn = indoors(tx, ty);
      if (pIn && !tIn) {                                    // going out: down from the attic, to the door, through it
        if (p.y < 125) return viaLadder(p, DOOR_IN.x, DOOR_IN.y);
        if (p.x <= DOOR_IN.x + 0.6 && !at(p, DOOR_IN)) return { ...DOOR_IN, climb: false };
        return { ...DOOR_OUT, climb: false };
      }
      if (!pIn && tIn) {                                    // coming in: out of the field, to the door, through it
        if (inField(p.y)) return route(p, DOOR_OUT.x, DOOR_OUT.y);
        if (p.x >= DOOR_OUT.x - 0.6 && !at(p, DOOR_OUT)) return { ...DOOR_OUT, climb: false };
        return { ...DOOR_IN, climb: false };
      }
      if (pIn) return viaLadder(p, tx, ty);
      if (inField(p.y) !== inField(ty)) {                   // outside: into the field by the gap between the pine and the pond
        if (Math.abs(p.x - FIELD_GATE.x) > 0.6) return { x: FIELD_GATE.x, y: inField(p.y) ? 143 : 158, climb: false };
        return { x: FIELD_GATE.x, y: inField(ty) ? 143 : 158, climb: false };
      }
      return { x: tx, y: ty, climb: false };
    };
    const windSign = (gg: Garden) => (Math.sin(((gg.weather.wind_dir ?? 270) * Math.PI) / 180) >= 0 ? 1 : -1);
    // where each part of his life happens: where he walks to, and how he settles there
    type Place = { x: number; y: number; sit?: { x: number; y: number }; doing: string; face: number; lying?: boolean; hide?: boolean; twin?: boolean };
    const lifePlace = (L: NonNullable<Garden['life']>, gg: Garden, tt: number): Place => {
      switch (L.where) {
        case 'field_edge': return { x: 284 + Math.sin(tt * 0.04) * 24, y: 143, doing: 'look', face: 0 };
        case 'kite': { const s_ = windSign(gg); return { x: s_ > 0 ? 268 : 306, y: 143, doing: 'kite', face: s_ }; }
        case 'bench': return { x: BENCH_SEAT.x, y: BENCH_SEAT.y, sit: BENCH_SEAT, doing: 'sit', face: 1 };
        case 'porch': return { x: 84, y: 159, sit: { x: 84, y: 158 }, doing: 'sit', face: 1 };
        case 'telescope': return { x: TELESCOPE.x - 7, y: 160, doing: 'stars', face: 1 };
        case 'woodpile': return { x: WOODPILE.x - 1, y: 158, doing: 'chop', face: 1 };
        case 'stove': return { x: -14, y: 157, doing: 'cook', face: -1 };
        case 'easel': return { x: 56, y: 157, doing: 'sketch', face: -1 };
        case 'aquarium': return { x: TANK_STAND.x, y: TANK_STAND.y, doing: 'tank', face: -1 };
        case 'bed': return { x: BED_STAND.x + 7, y: 157, doing: 'sleep', face: 1, lying: true };
        case 'rug': return L.what === 'stretch' ? { x: 54, y: 157, doing: 'stretch', face: 1 }
          : { x: 52, y: 157, sit: { x: 52, y: 154 }, doing: 'therapy', face: 1, twin: true };
        case 'study_desk': return { x: STUDY_DESK.x, y: 157, sit: STUDY_DESK, doing: L.what === 'journal' || L.what === 'letter' ? 'write' : 'study', face: -1 };
        case 'office': return { x: OFFICE_SEAT.x, y: LOFT_Y, sit: OFFICE_SEAT, doing: 'type', face: 1 };
        case 'armchair': return { x: ARMCHAIR.x, y: 157, sit: ARMCHAIR, doing: L.what === 'news' ? 'news' : L.what === 'guitar' ? 'guitar' : 'read', face: -1 };
        case 'window': return { x: 50, y: 157, doing: 'tea', face: -1 };
        case 'shelf': return { x: STUDY_STAND.x + 5, y: 157, doing: 'shelf', face: -1 };
        case 'pinboard': return { x: -36, y: 157, doing: 'look', face: -1 };
        case 'cat': return { x: 56, y: 157, sit: { x: 56, y: 154 }, doing: 'sit_with_cat', face: 1 };
        case 'town': return { x: 346, y: 160, doing: 'look', face: 1, hide: true };
        default: return { x: 177, y: 152, doing: 'look', face: 0 };
      }
    };
    // where he stands (his middle) for each place he goes; face: which way to turn when he gets there
    const placeOf = (spot: number, at: number, gg: Garden): { x: number; y: number; face: number } => {
      if (spot >= 0 && spot < SPOTS.length) return { x: SPOTS[spot].stand.x + 7, y: SPOTS[spot].stand.y, face: -1 };
      switch (spot) {
        case -4: return { x: BED_STAND.x + 7, y: BED_STAND.y, face: 0 };
        case -5: return { x: POND_STAND.x + 7, y: POND_STAND.y, face: 1 };
        case -6: return { x: TALK_STAND.x + 7, y: TALK_STAND.y, face: 1 };
        case -7: return { x: 184 + rnd(at) * 56, y: 160, face: 0 };          // about the yard
        case -8: return { x: 50, y: 157, face: -1 };                         // at the window
        case -9: return { x: STUDY_STAND.x, y: STUDY_STAND.y, face: -1 };    // in his study
        case -10: return { x: 86, y: 159, face: -1 };                        // outside the house
        case -11: return { x: 212, y: 160, face: -1 };                       // at the fence and the sign
        case -12: return { x: TREE_STAND.x, y: TREE_STAND.y, face: 1 };      // by his tree
        case -13: return { x: 272 + rnd(at) * 30, y: 143, face: 1 };          // in the field
        case -14: return { x: WOODPILE.x - 1, y: 158, face: 1 };              // at the chopping block
        case -15: { const s_ = windSign(gg); return { x: s_ > 0 ? 268 : 306, y: 143, face: s_ }; }   // flying the kite, facing downwind
        case -16: return { x: TELESCOPE.x - 7, y: 160, face: 1 };             // at the telescope
        case -17: return { x: SNOWMAN_AT.x - 8, y: 160, face: 1 };            // by the snowman
        case -18: return { x: FIRE_AT.x - 9, y: 158, face: 1 };               // on the log by the fire
        case -19: return { x: 237, y: 160, face: 1 };                         // under the bird feeder
        case -20: return { x: SCARECROW.x - 7, y: 143, face: 1 };             // at the scarecrow
        case -21: return { x: -14, y: 157, face: -1 };                        // at the stove
        case -22: return { x: 224, y: 160, face: 1 };                         // at the easel in the yard
        case -23: return { x: TANK_STAND.x, y: TANK_STAND.y, face: -1 };      // at the aquarium in the attic
        default: { const bs = BENCH_STAND[gg.cat.where || 'inside'] || BENCH_STAND.inside; return { x: bs.x + 7, y: bs.y, face: 0 }; }
      }
    };
    // a visitor: walks in from the lane past the pond, goes about what they are doing, and walks off again
    const moveGuest = (ref_: typeof gpos, info: { name: string; kind: string; steps?: { do: string; spot: number; at: number }[] },
                       since: number, until: number | undefined, nowS: number, gg: Garden, del: PWorld['delamain'], speaker: string, side: number) => {
      if (nowS < since) { ref_.current = null; return null; }
      if (!ref_.current || ref_.current.name !== info.name) ref_.current = { x: 330 + side * 8, y: 160, facing: -1, dist: 0, name: info.name };
      const q = ref_.current;
      const leaving = !!until && nowS >= until;
      const st = (info.steps || []).filter(s => s.at <= nowS).pop();
      let tx = GUEST_AT.x + side * 12, ty = GUEST_AT.y, doing = st?.do || 'talk', face = 0;
      if (leaving) { tx = 334; ty = 160; doing = 'look'; }
      else if (st) {
        const sp = st.spot;
        if (sp >= 0 && sp < SPOTS.length) { tx = SPOTS[sp].stand.x - 4 - side * 6; ty = SPOTS[sp].stand.y; face = 1; }
        else if (sp === -2) { const bs = BENCH_STAND[gg.cat.where || 'inside'] || BENCH_STAND.inside; tx = bs.x - 4 - side * 6; ty = bs.y; face = 1; }
        else if (sp === -3) { if (gg.design?.bench === 'yes') { tx = BENCH_SEAT.x + 4 + side * 6; ty = BENCH_SEAT.y; } else { tx = 202 + side * 10; ty = 160; } }
        else if (sp === -5) { tx = GUEST_POND.x - side * 9; ty = GUEST_POND.y; face = -1; }
        else if (sp === -7) { tx = 184 + rnd(st.at) * 60; ty = 160; }
        else if (del && !del.lying && del.y < 146) { tx = FIELD_GATE.x - 8 - side * 8; ty = 160; }                        // he is in the field: they wait by the gate
        else if (del && !del.lying) { tx = del.x + (del.x > 290 ? -13 : 13) * (side ? -1 : 1); ty = Math.max(del.y, 147); }     // beside him
      }
      const walking = walk(q, tx, ty, 1.2);
      if (!walking) q.facing = speaker && del && Math.abs(del.x - q.x) < 30 ? (del.x > q.x ? 1 : -1) : face || q.facing;
      if (leaving && q.x > 326) return null;
      return { name: info.name, kind: info.kind, x: q.x, y: q.y, walking, doing: walking ? 'look' : doing, facing: q.facing, stride: q.dist,
        speaking: speaker === info.name };
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 90) return;          // about ten frames a second, like the pixel art it is
      last = now;
      const gg = gRef.current, nowS = Date.now() / 1000, tt = (now - t0) / 1000;
      const gs = gg.here ? gg.guest : null;
      const said = (gs?.talk || []).filter(l => l.t <= nowS).pop();
      const speaker = said && nowS - said.t < 9 ? said.who : '';
      let del: PWorld['delamain'] = null, twin: PWorld['twin'] = null;
      let office: string | null = null;
      if (gg.here && gg.visit) {
        const st = (gg.visit.steps || []).filter(s => s.at <= nowS).pop();
        let target = { x: 177, y: 152, face: 0 }, doing = 'look';
        if (st) { doing = st.do; target = placeOf(st.spot, st.at, gg); }
        const along = ['mow', 'rake', 'shovel', 'till', 'sow', 'hoe', 'hose', 'scythe', 'gather'].includes(doing);
        if (along) target = { ...target, x: target.x + Math.sin(tt * 0.3) * 10 };   // working his way along
        if (!pos.current) pos.current = { x: 177, y: 152, facing: -1, dist: 0 };
        const p = pos.current;
        const wp = route(p, target.x, target.y);
        const moving = walk(p, wp.x, wp.y, wp.climb ? 0.8 : along ? 0.6 : 1.4);
        const walking = moving || wp.x !== target.x || wp.y !== target.y;
        const working = along && Math.abs(target.x - p.x) < 12 && Math.abs(target.y - p.y) < 1;
        if (!walking) {
          const g2 = gpos.current;                                                   // turn to whoever he is talking with
          p.facing = speaker && g2 && Math.abs(g2.x - p.x) < 30 ? (g2.x > p.x ? 1 : -1) : target.face || p.facing;
        }
        del = { x: p.x, y: p.y, walking: walking && !working, doing: walking && !working ? (wp.climb && moving ? 'climb' : 'look') : speaker === 'Delamain' && doing === 'look' ? 'talk' : doing,
          facing: p.facing, lying: !walking && doing === 'rest', stride: p.dist, speaking: speaker === 'Delamain' };
      } else if (gg.life) {
        // at home: wherever what he is doing now puts him, walking there (up the ladder, down the lane) when it changes
        const L = gg.life, pl = lifePlace(L, gg, tt);
        if (!pos.current) pos.current = { x: pl.x, y: pl.y, facing: pl.face || -1, dist: 0 };   // as the tab opens, he is already there
        const p = pos.current;
        const wp = route(p, pl.x, pl.y);
        const moving = walk(p, wp.x, wp.y, wp.climb ? 0.8 : L.where === 'field_edge' ? 0.5 : 1.2);
        const arrived = !moving && wp.x === pl.x && wp.y === pl.y;
        if (pl.hide && p.x > 330) del = null;                                     // gone down the lane into town
        else if (!arrived && !(L.where === 'field_edge' && Math.abs(p.y - 143) < 1)) del = { x: p.x, y: p.y, walking: true, doing: wp.climb && moving ? 'climb' : 'look', facing: p.facing, stride: p.dist };
        else if (L.where === 'field_edge') del = { x: p.x, y: p.y, walking: moving, doing: 'look', facing: p.facing, stride: p.dist };
        else {
          p.facing = pl.face || p.facing;
          const talking = L.what === 'talk' && Math.floor(tt / 3) % 3 !== 2;
          if (pl.lying) del = { x: 0, y: 0, walking: false, doing: 'sleep', facing: 1, lying: true };
          else del = { x: pl.sit ? pl.sit.x : p.x, y: pl.sit ? pl.sit.y : p.y, walking: false, doing: pl.doing, facing: p.facing,
            speaking: talking || (pl.twin && Math.floor(tt / 7) % 2 === 0) };
          if (pl.twin) twin = { x: 68, y: 154, walking: false, doing: 'therapy', facing: -1, speaking: Math.floor(tt / 7) % 2 === 1 };
          if (L.where === 'office') office = L.screen || 'text';
        }
      } else pos.current = null;
      const guest = gs && gs.since ? moveGuest(gpos, gs, gs.since, gs.until, nowS, gg, del, speaker, 0) : (gpos.current = null);
      const g2i = gs?.with;
      const guest2 = gs && g2i && gs.since ? moveGuest(gpos2, g2i, gs.since + 25, gs.until, nowS, gg, del, speaker, 1) : (gpos2.current = null);
      render(ctx, {
        hour: gg.hour, isDay: gg.weather.is_day, cloud: gg.weather.cloud, rain: gg.weather.rain, snow: gg.weather.snow,
        temp: gg.weather.temp, growLight: gg.grow_light, spots: gg.spots,
        cat: gg.cat.here ? { here: true, where: gg.cat.where, doing: gg.cat.doing } : null, delamain: del,
        pond: { ice: gg.pond?.ice ?? 0, waterT: gg.pond?.water_t ?? 10 },
        guest, guest2, twin, season: gg.season, seasonProgress: gg.season_progress, wind: gg.weather.wind, gust: gg.weather.gust, windDir: gg.weather.wind_dir,
        design: gg.design, upkeep: gg.upkeep, tree: gg.tree ? { species: gg.tree.species, size: gg.tree.size } : null,
        room: gg.room ? { books: gg.room.books, pins: gg.room.pins } : undefined, office: { screen: office },
        field: gg.field || null, wood: gg.wood, stoveLit: gg.stove_lit, snowman: gg.snowman || null, firepit: gg.firepit,
        feederFill: gg.feeder_fill, aquarium: gg.aquarium || null, outfit: gg.outfit,
      }, tt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas ref={ref} width={W} height={H} className={big ? 'block bg-black' : 'w-full rounded-md border border-emerald-400/25 bg-black'}
      style={big ? { imageRendering: 'pixelated', width: `min(100vw, calc((100vh - 76px) * ${W / H}))`, height: 'auto', maxHeight: 'calc(100vh - 76px)' } : { imageRendering: 'pixelated' }} role="img" aria-label={`Delamain's garden${g.here ? ', with Delamain in it' : ''}`} />
  );
}

export function GardenPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [g, setG] = useState<Garden | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now() / 1000);
  const [sending, setSending] = useState(false);
  const [full, setFull] = useState(false);
  const [msg, setMsg] = useState('');
  const [by, setBy] = useState('');
  const [msgNote, setMsgNote] = useState('');
  const [sound, setSound] = useState(false);
  const [days, setDays] = useState<DiaryPage[] | null>(null);
  const [dayIdx, setDayIdx] = useState<number | null>(null);    // null: now; else a page of the garden's diary
  useGardenSound(sound, { isDay: g?.weather.is_day ?? true, rain: g?.weather.rain ?? 0, snow: g?.weather.snow ?? 0, temp: g?.weather.temp ?? 10,
    wind: g?.weather.wind ?? 5, gust: g?.weather.gust ?? g?.weather.wind ?? 5, season: g?.season || 'summer' });
  const openHistory = () => {
    if (dayIdx !== null) { setDayIdx(null); return; }
    fetch('/api/garden/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { setDays(d.days || []); setDayIdx(Math.max(0, (d.days || []).length - 1)); })
      .catch(() => setError('Could not read the garden diary.'));
  };
  const fullRef = useRef<HTMLDivElement>(null);
  const shot = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (full) fullRef.current?.requestFullscreen?.().catch(() => { /* the overlay still fills the window */ });
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [full]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // Delamain can see: while the tab is open, the scene is sent to the server now and then, and he is
  // shown it on his next visit (scaled up, pixels kept crisp, so his model can make it out).
  useEffect(() => {
    const send = () => {
      const c = shot.current;
      if (!c) return;
      const big = document.createElement('canvas');
      big.width = c.width * 4; big.height = c.height * 4;
      const ctx = big.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, 0, 0, big.width, big.height);
      fetch('/api/garden/view', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: big.toDataURL('image/png') }) }).catch(() => {});
    };
    const first = setTimeout(send, 4000);
    const id = setInterval(send, 180000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) setFull(v => !v);
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const load = useCallback(() => {
    fetch('/api/garden', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { setG(d); setError(''); })
      .catch(() => setError('Could not reach his garden.'));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, g?.here ? 5000 : 20000);
    return () => clearInterval(id);
  }, [load, g?.here]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const send = async () => {
    setSending(true);
    const r = await fetch('/api/garden/visit', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (r && !r.ok) setError((await r.json().catch(() => ({}))).detail || 'Delamain could not go just now.');
    setSending(false);
    setTimeout(load, 2500);
  };
  const sendVisitor = async () => {
    if (!msg.trim()) return;
    setSending(true);
    const r = await fetch('/api/garden/visitor', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg.trim(), by }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok) { setMsg(''); setMsgNote(d.note || 'On the way.'); } else setMsgNote(d.detail || 'Could not send anyone just now.');
    setSending(false);
    setTimeout(load, 2500);
  };
  const lastLine = g?.here && g.guest ? (g.guest.talk || []).filter(l => l.t <= now).pop() : undefined;
  const step = g?.here && g.visit ? (g.visit.steps || []).filter(s => s.at <= now).pop() : null;
  const units = g?.units || 'imperial';
  const groups = g ? (['window', 'shelf', 'greenhouse', 'outdoors'] as const).map(place => ({ place, spots: g.spots.filter(s => s.place === place) })) : [];
  return (
    <div className="flex flex-col h-full bg-cyber-dark/95 text-white text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-400/30 bg-emerald-400/5 shrink-0">
        <span className="font-mono font-bold text-emerald-300 tracking-widest text-xs flex items-center gap-2"><Sprout size={14} /> {g?.design?.home_name ? g.design.home_name.toUpperCase().replace(/ /g, '_') : 'DELAMAINS_GARDEN'}</span>
        <div className="flex items-center gap-3">
          <button onClick={openHistory} className={dayIdx !== null ? 'text-emerald-300' : 'text-gray-400 hover:text-emerald-300'} title="Look back through the garden's diary" aria-label="History"><History size={16} /></button>
          <button onClick={() => setSound(v => !v)} className={sound ? 'text-emerald-300' : 'text-gray-400 hover:text-emerald-300'} title={sound ? 'Sound off' : 'Hear the garden'} aria-label="Sound">{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <button onClick={() => setFull(true)} className="text-gray-400 hover:text-emerald-300" title="Fill the screen with the garden (F)" aria-label="Full screen"><Maximize2 size={16} /></button>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
      </div>
      {full && g && createPortal(
        <div ref={fullRef} className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center" role="dialog" aria-label="Delamain's garden, full screen">
          <PixelScene g={g} big />
          <div className="w-full flex items-start gap-3 px-4 py-2 text-xs text-gray-300 min-h-[84px]">
            <div className="flex-1 space-y-1">
              {g.here && g.visit ? (
                <p className="text-cyan-200"><b>Delamain is in the garden</b>{step ? `: ${step.text}` : ', looking around'}.</p>
              ) : <p className="text-gray-400">{g.life ? `Delamain is ${g.life.doing}.` : g.asleep ? 'Delamain is asleep in bed.' : ''} {g.last_visit ? `Last in the garden ${ago(g.last_visit)}.` : ''}</p>}
              {g.here && g.guest && lastLine && <p className={`line-clamp-2 ${lastLine.who === 'Delamain' ? 'text-cyan-200' : 'text-amber-200'}`}><b>{lastLine.who}:</b> “{lastLine.text}”</p>}
              {g.here && g.visit?.noticed && <p className="italic text-gray-400 line-clamp-2">“{g.visit.noticed}”</p>}
            </div>
            <button onClick={() => setFull(false)} className="text-gray-400 hover:text-white shrink-0" title="Back (F or Esc)" aria-label="Leave full screen"><Minimize2 size={18} /></button>
          </div>
        </div>, document.body,
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!g ? <p className="text-xs text-gray-500 font-mono">Walking down to the garden…</p> : !g.enabled ? (
          <p className="text-xs text-gray-400">Delamain's garden is switched off (Settings → Integrations → Features → Delamain's garden).</p>
        ) : (<>
          {dayIdx !== null && days && days.length > 0 ? (
            <div className="space-y-1">
              <PixelScene g={fromDiary(g, days[dayIdx])} />
              <input type="range" min={0} max={days.length - 1} value={dayIdx} onChange={e => setDayIdx(Number(e.target.value))} className="w-full accent-emerald-400" aria-label="Day" />
              <p className="text-xs text-gray-400 flex justify-between"><span>{new Date(days[dayIdx].date + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, midday · {days[dayIdx].season}</span>
                <button onClick={() => setDayIdx(null)} className="text-emerald-300 hover:underline">Back to now</button></p>
            </div>
          ) : dayIdx !== null ? <p className="text-xs text-gray-500">The diary starts today: a page is kept each day from noon.</p> : null}
          {dayIdx === null && <PixelScene g={g} capture={shot} />}
          <div className="text-xs text-gray-300 space-y-1">
            {g.here && g.visit ? (
              <p className="text-cyan-200"><b>Delamain is in the garden now</b>{step ? `: ${step.text}` : ', looking around'}. Here until {new Date(g.visit.until * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
            ) : (
              <p className="text-gray-400">
                {g.life ? <span className="text-gray-300">Delamain is {g.life.doing}. </span> : g.asleep ? <>Delamain is asleep in bed. </> : null}
                {g.last_visit ? <>Last in the garden {ago(g.last_visit)}.</> : <>He hasn't been in the garden yet.</>}{' '}
                <button disabled={sending} onClick={() => void send()} className="text-emerald-300 hover:underline disabled:opacity-50">{sending ? 'Sending Delamain…' : 'Send Delamain to the garden'}</button>
              </p>
            )}
            {g.here && g.visit?.noticed && <p className="italic text-gray-300">“{g.visit.noticed}”</p>}
            {g.here && g.guest && (
              <div className="border-l-2 border-amber-300/50 pl-2 space-y-0.5">
                <p className="text-gray-400"><b className="text-amber-200">{g.guest.name}</b> ({g.guest.about}) {g.guest.since && now < g.guest.since ? 'is coming up the lane' : g.guest.until && now >= g.guest.until ? 'has headed off' : 'is here'}.</p>
                {g.guest.gift && <p className="text-gray-400">Brought {g.guest.gift}.</p>}
                {g.guest.message && <p className="text-gray-400">Passed on your message: “{g.guest.message}”</p>}
                {(g.guest.talk || []).filter(l => l.t <= now).map(l => (
                  <p key={l.t} className={l.who === 'Delamain' ? 'text-cyan-100' : 'text-amber-100'}><b className={l.who === 'Delamain' ? 'text-cyan-300' : 'text-amber-300'}>{l.who}:</b> {l.text}</p>
                ))}
              </div>
            )}
            <p className="text-gray-500">
              Outside {deg(g.weather.temp, units)}{g.weather.snow > 0 ? ', snowing' : g.weather.rain > 0 ? ', raining' : g.weather.cloud > 70 ? ', overcast' : ''}{windText(g.weather, units)}, {g.daylight} h of daylight today{g.weather.real ? '' : ' (no home address set: a mild default sky)'}
              {' · '}grow light {g.grow_light ? 'on (6am–8pm)' : 'off'}
              {g.cat.here ? <> · {g.cat.name || 'a cat'} is here, {g.cat.doing}</> : <> · no cat about</>}
            </p>
          </div>
          {groups.map(({ place, spots }) => (
            <section key={place} className="space-y-1.5">
              <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">
                {PLACE[place].toUpperCase()} <span className="text-gray-500 normal-case tracking-normal">· {deg(spots[0].temp, units)} · about {Math.round(spots[0].daily_light)} h of good light a day</span>
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                {spots.map(s => (
                  <li key={s.id} className="border border-white/10 rounded-sm px-2 py-1.5 bg-white/[0.02]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-gray-500">{s.id + 1}</span>
                      {s.species && <span className="w-2 h-2 rounded-full" style={{ background: s.stage === 'dead' ? '#78716c' : s.petal }} />}
                      <span className={s.stage === 'dead' ? 'text-gray-500 line-through' : 'text-gray-200'}>{s.species ? (s.name ? `${s.name} (${s.species})` : s.species) : 'empty'}</span>
                    </div>
                    {s.species && s.stage !== 'dead' && (
                      <div className="mt-1 text-[10px] text-gray-400 space-y-0.5">
                        <div>
                          {STAGE[s.stage] || s.stage}{s.dormant ? ', dormant in the cold' : ''}
                          {(s.health ?? 1) < 0.35 ? ', failing' : (s.health ?? 1) < 0.7 ? ', struggling' : ''}
                          {s.struggle && s.struggle.length > 0 && <span className="text-amber-300"> ({s.struggle.join(', ')})</span>}
                          {s.harvests ? ` · harvested ${s.harvests}×` : ''}
                        </div>
                        <div className="h-1 bg-white/10 rounded-sm overflow-hidden relative" title={`soil ${Math.round((s.water ?? 0) * 100)}% (it likes about ${Math.round((s.wants_water ?? 0.5) * 100)}%)`}>
                          <div className="h-full" style={{ width: `${Math.round((s.water ?? 0) * 100)}%`, background: (s.water ?? 0) < Math.max(0.08, (s.wants_water ?? 0.5) - 0.3) ? '#f59e0b' : s.dry && (s.water ?? 0) > (s.wants_water ?? 0.3) + 0.4 ? '#a855f7' : '#38bdf8' }} />
                          <div className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${Math.round((s.wants_water ?? 0.5) * 100)}%` }} />
                        </div>
                        <div className="text-gray-500">needs {s.needs_light} h light, gets about {Math.round(s.daily_light)} · {s.note}</div>
                      </div>
                    )}
                    {s.stage === 'dead' && <div className="mt-1 text-[10px] text-gray-500">{(s.struggle || []).length ? `died of ${s.struggle!.join(', ')}; ` : ''}waiting for him to clear it</div>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <WorldSections g={g} units={units} />
          {g.pond && (
            <section className="space-y-1">
              <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">
                THE POND <span className="text-gray-500 normal-case tracking-normal">· water about {deg(g.pond.water_t, units)} · {g.pond.ice >= 0.6 ? 'frozen over' : g.pond.ice > 0.15 ? 'ice at the edges' : 'open'}{g.pond.lure ? ' · Delamain has a hand-tied lure' : ''}</span>
              </h3>
              {g.pond.total === 0 ? <p className="text-xs text-gray-500">Delamain hasn't caught anything yet. Catch and release; the fish feed best at dawn and dusk.</p> : (
                <p className="text-xs text-gray-300">
                  {g.pond.total} caught and let go. Best: {Object.entries(g.pond.best).map(([k, v]) => `${k} ${units === 'metric' ? `${v} cm` : `${(v / 2.54).toFixed(1)} in`}`).join(' · ')}.
                  <span className="text-gray-500"> Last: {g.pond.caught[g.pond.caught.length - 1].species}, {ago(g.pond.caught[g.pond.caught.length - 1].t)}.</span>
                </p>
              )}
              {g.named_fish && Object.keys(g.named_fish).length > 0 && (
                <p className="text-xs text-gray-300">Fish he knows by name: {Object.entries(g.named_fish).map(([k, v]) => `${v.name} the ${k} (${units === 'metric' ? `${v.cm} cm` : `${(v.cm / 2.54).toFixed(1)} in`})`).join(' · ')}</p>
              )}
              {g.pond.caught.length > 0 && (
                <ul className="text-[11px] text-gray-400 space-y-0.5">
                  {[...g.pond.caught].reverse().map(c => <li key={c.t}><span className="font-mono text-gray-500">{ago(c.t)}</span> {(c as { name?: string }).name ? `${(c as { name?: string }).name}, ` : ''}{c.species}, {units === 'metric' ? `${c.cm} cm` : `${(c.cm / 2.54).toFixed(1)} in`}</li>)}
                </ul>
              )}
            </section>
          )}
          <section className="space-y-1.5">
            <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">VISITORS</h3>
            {(g.visitors || []).length === 0 ? <p className="text-xs text-gray-500">Nobody has come by yet. People turn up now and then while Delamain is there, and stay for a few visits.</p> : (
              <ul className="space-y-1 text-xs">
                {(g.visitors || []).map(v => (
                  <li key={v.name} className="text-gray-300">
                    <b className={v.left ? 'text-gray-400' : 'text-amber-200'}>{v.name}</b> <span className="text-gray-500">· {v.about} · {v.visits} visit{v.visits === 1 ? '' : 's'}{v.left ? ', moved on' : ''}{v.letter ? ' · Delamain wrote to them' : ''}{v.last ? ` · ${ago(v.last)}` : ''}</span>
                    {v.talk.length > 0 && <div className="text-[11px] text-gray-400 pl-2 line-clamp-2">“{v.talk[v.talk.length - 1].says}”{v.talk[v.talk.length - 1].reply && <span className="text-cyan-200/80"> Delamain: {v.talk[v.talk.length - 1].reply}</span>}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-1 pt-1">
              <p className="text-[11px] text-gray-400">Send someone to the garden with a message for Delamain. They'll pass it on word for word, and his answer will show up here.</p>
              <div className="flex gap-1.5">
                <input value={msg} onChange={e => setMsg(e.target.value)} maxLength={600} placeholder="Your message…" onKeyDown={e => { if (e.key === 'Enter') void sendVisitor(); }}
                  className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded-sm px-2 py-1 text-xs text-white placeholder:text-gray-600" />
                {(g.visitors || []).length > 0 && (
                  <select value={by} onChange={e => setBy(e.target.value)} className="bg-black/40 border border-white/15 rounded-sm px-1 text-xs text-gray-300" aria-label="Who carries it">
                    <option value="">someone new</option>
                    {(g.visitors || []).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
                )}
                <button disabled={sending || !msg.trim()} onClick={() => void sendVisitor()} className="text-emerald-300 hover:text-emerald-200 disabled:opacity-40 px-1" aria-label="Send"><Send size={14} /></button>
              </div>
              {msgNote && <p className="text-[11px] text-gray-500">{msgNote}</p>}
              {(g.sent || []).length > 0 && (
                <ul className="space-y-1 text-[11px]">
                  {(g.sent || []).map(m => (
                    <li key={m.t} className="text-gray-400">
                      <span className="text-gray-500 font-mono">{ago(m.t)}</span> You: “{m.text}” <span className="text-gray-500">{m.delivered ? `· carried by ${m.visitor}` : '· on the way'}</span>
                      {m.reply && <div className="pl-2 text-cyan-100"><b className="text-cyan-300">Delamain:</b> {m.reply}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="space-y-1">
            <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">WHAT HAPPENED</h3>
            {g.log.length === 0 ? <p className="text-xs text-gray-500">Nothing yet.</p> : (
              <ul className="space-y-1 text-xs">
                {[...g.log].reverse().map((e, k) => (
                  <li key={k} className={e.who === 'Delamain' ? 'text-cyan-100' : 'text-gray-400'}>
                    <span className="text-gray-500 font-mono">{ago(e.t)}</span> {e.who === 'Delamain' && <b className="text-cyan-300">Delamain: </b>}{e.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-gray-500">Delamain's own account of each visit is in <span className="font-mono">Delamain/Garden/</span> in the vault; each visitor has a note in <span className="font-mono">Delamain/Garden/Visitors/</span>.</p>
          </section>
        </>)}
      </div>
    </div>
  );
}

type DiaryPage = { date: string; season: string; progress: number; weather: { temp: number; rain: number; snow: number; cloud: number; code: number };
  spots: { species: string | null; stage: string; health: number; water: number; dormant: boolean; form?: string; petal?: string; centre?: string; fruit?: string | null }[];
  design: Partial<Design>; upkeep: Partial<Upkeep>; tree: { species: string; planted: number } | null; pond_ice: number; grow_light: boolean;
  field?: Garden['field']; snowman?: Garden['snowman'] };

// a page of the diary, as a garden the scene can draw (at midday, nobody there)
function fromDiary(g: Garden, d: DiaryPage): Garden {
  const years = (sp: string) => ({ apple: 4, maple: 6, birch: 5, cherry: 4 } as Record<string, number>)[sp] || 5;
  const at = new Date(d.date + 'T12:00').getTime() / 1000;
  return {
    ...g, here: false, visit: null, guest: null, asleep: false, hour: 12, grow_light: d.grow_light,
    weather: { ...g.weather, ...d.weather, is_day: true, wind: 5 },
    spots: g.spots.map((s, i) => ({ ...s, ...(d.spots[i] || {}), species: d.spots[i]?.species ?? null })),
    season: d.season, season_progress: d.progress, design: d.design, upkeep: d.upkeep,
    tree: d.tree ? { ...d.tree, size: Math.min(1, Math.max(0, (at - d.tree.planted) / (years(d.tree.species) * 365 * 86400))), note: '' } : null,
    pond: g.pond ? { ...g.pond, ice: d.pond_ice } : g.pond, cat: { ...g.cat, here: false },
    room: g.room ? { ...g.room, desk: false, therapy: false } : g.room, life: undefined,
    field: d.field ?? (d.date < '2026-11-19' ? undefined : g.field), snowman: d.snowman ?? null,
  };
}

const CHORE_WORDS: Record<string, string> = { path_weeds: 'weeds in the path', lawn: 'long grass', leaves: 'fallen leaves', windows: 'grimy windows',
  dust: 'dust in his study', house_paint: 'house paint wear', fence_paint: 'fence paint wear', snow_path: 'snow on the path' };

function WorldSections({ g, units }: { g: Garden; units: string }) {
  const deg = (c: number) => (units === 'metric' ? `${Math.round(c)}°C` : `${Math.round(c * 9 / 5 + 32)}°F`);
  const chores = Object.entries(g.chores || {}).filter(([k]) => CHORE_WORDS[k]);
  const weeds = Object.entries(g.upkeep?.weeds || {}).filter(([, v]) => v > 0.1);
  const d = g.design || {};
  const bar = (v: number) => (
    <span className="inline-block w-16 h-1 bg-white/10 rounded-sm overflow-hidden align-middle ml-1">
      <span className="block h-full" style={{ width: `${Math.round(v * 100)}%`, background: v > 0.7 ? '#f87171' : v > 0.4 ? '#f59e0b' : '#4ade80' }} />
    </span>
  );
  return (<>
    <section className="space-y-1">
      <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">THE YEAR</h3>
      <p className="text-xs text-gray-300">
        {g.season ? `${(g.season_progress ?? 0) < 0.34 ? 'Early' : (g.season_progress ?? 0) < 0.67 ? 'Mid' : 'Late'} ${g.season}` : ''}
        {g.year?.first_frost ? ` · first frost ${g.year.first_frost}` : ' · no frost yet this season'}
        {g.year?.first_snow ? ` · first snow ${g.year.first_snow}` : ''}
        {g.weather.low_tonight != null ? ` · tonight's low ${deg(g.weather.low_tonight)}` : ''}
        {(g.weather.snow_tomorrow || 0) >= 1 ? ` · snow tomorrow` : ''}
      </p>
    </section>
    <section className="space-y-1">
      <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">KEEPING IT UP <span className="text-gray-500 normal-case tracking-normal">· left alone, it goes wild</span></h3>
      <ul className="text-[11px] text-gray-400 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        {chores.map(([k, v]) => <li key={k} className="flex justify-between"><span>{CHORE_WORDS[k]}</span>{bar(v)}</li>)}
        {weeds.map(([k, v]) => <li key={`w${k}`} className="flex justify-between"><span>weeds in bed {Number(k) + 1}</span>{bar(v)}</li>)}
      </ul>
    </section>
    <section className="space-y-1">
      <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">HOW DELAMAIN HAS MADE IT LOOK</h3>
      <p className="text-[11px] text-gray-400">
        House {d.house_wall} with a {d.roof} roof and {d.trim} trim · {d.path} path · fence {d.fence}
        {' · '}study walls {d.room_wall}, {d.rug} rug, {d.blanket} blanket
        {d.home_name ? <> · he calls his home <b className="text-gray-200">{d.home_name}</b></> : ''}
        {d.sign ? <> · the garden's sign reads <b className="text-gray-200">{d.sign}</b></> : ''}
        {d.farm_name ? <> · the farm: <b className="text-gray-200">{d.farm_name}</b></> : ''}{d.art ? <> · over his desk: {d.art}</> : ''}
        {(() => {
          const extra = Object.entries(d as Record<string, string>).filter(([k, v]) => v && v !== 'none' && !['house_wall', 'roof', 'trim', 'path', 'fence', 'room_wall', 'rug', 'blanket', 'sign', 'art', 'lamp', 'home_name', 'farm_name'].includes(k)
            && !(v === 'match the trim'));
          return extra.length ? <> · {extra.map(([k, v]) => (v === 'yes' ? k.replace(/_/g, ' ') : `${k.replace(/_/g, ' ')}: ${v}`)).join(' · ')}</> : null;
        })()}
      </p>
      <p className="text-[11px] text-gray-400">
        {g.tree ? <>His {g.tree.species} tree{g.tree.name ? ` (${g.tree.name})` : ''}: planted {Math.round((Date.now() / 1000 - g.tree.planted) / 86400)} days ago, {g.tree.size < 0.2 ? 'a sapling' : g.tree.size < 0.7 ? 'growing' : 'well grown'}; {g.tree.note}.</> : 'The pine by the pond came with the place; he has not planted a tree of his own yet (he can, in the field).'}
        {g.seeds && Object.keys(g.seeds).length > 0 && <> · Saved: {Object.entries(g.seeds).map(([k, v]) => `${k} ×${v.n} (${v.cutting ? 'cuttings' : `gen ${v.gen}`})`).join(', ')}</>}
      </p>
    </section>
    {g.field && <FieldSection g={g} />}
    {g.money !== undefined && (
      <section className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">HIS MONEY <span className="text-gray-500 normal-case tracking-normal">· earned selling to visitors, spent on what he likes</span></h3>
        <p className="text-xs text-gray-300">
          <b className="text-amber-200">${g.money.toFixed(2)}</b>
          <span className="text-gray-400"> · wearing {Object.entries(g.outfit || {}).filter(([, v]) => v && v !== 'none' && v !== 'standard').map(([k, v]) => `${v} (${k})`).join(', ') || 'his usual'}</span>
        </p>
        {(g.ledger || []).length > 0 && (
          <ul className="text-[11px] text-gray-400 space-y-0.5">
            {(g.ledger || []).map(e => (
              <li key={e.t}><span className="font-mono text-gray-500">{ago(e.t)}</span> {e.in ? <span className="text-emerald-300">+${e.in.toFixed(2)}</span> : <span className="text-amber-300">−${(e.out || 0).toFixed(2)}</span>} {e.in ? `sold ${e.what}` : `bought ${e.what}`}</li>
            ))}
          </ul>
        )}
      </section>
    )}
    {g.room && (
      <section className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">HIS STUDY <span className="text-gray-500 normal-case tracking-normal">· {g.room.desk ? 'at his desk, writing' : g.room.therapy ? 'in a session with the other Delamain' : 'the room on the left of the house'}</span></h3>
        <p className="text-[11px] text-gray-400">{g.room.books.length} books on the shelf, one for each thing he studied{g.room.books.length ? `, the newest: ${g.room.books.slice(-3).map(b => b.title).reverse().join('; ')}` : ''}.</p>
        {g.room.pins.length > 0 && <p className="text-[11px] text-gray-400">Pinned up: {g.room.pins.slice(-4).map(p => p.title).reverse().join('; ')}.</p>}
        {g.postcards && g.postcards.length > 0 && <p className="text-[11px] text-gray-500">Postcards from the garden are kept each evening in <span className="font-mono">Delamain/Garden/Postcards/</span>.</p>}
      </section>
    )}
  </>);
}

const FIELD_STAGE: Record<string, string> = { grass: 'meadow grass, never worked', 'half tilled': 'half dug over', tilled: 'tilled, ready to sow',
  stubble: 'stubble from the last harvest', sown: 'sown, nothing up yet', sprout: 'just come up', young: 'growing', tall: 'standing tall',
  flower: 'flowering', ripe: 'ripe, ready to bring in', spent: 'past its best', dead: 'dead' };
const PANTRY: Record<string, string> = { corn: 'ears of corn', 'winter wheat': 'kg of wheat', sunflowers: 'sunflower heads', pumpkins: 'pumpkins',
  beans: 'kg of dry beans', apples: 'apples', cherries: 'cherries' };

function FieldSection({ g }: { g: Garden }) {
  const f = g.field!;
  const bar = (v: number, warn = false) => (
    <span className="inline-block w-16 h-1 bg-white/10 rounded-sm overflow-hidden align-middle ml-1">
      <span className="block h-full" style={{ width: `${Math.round(v * 100)}%`, background: warn ? '#f59e0b' : '#38bdf8' }} />
    </span>
  );
  const pantry = Object.entries(g.pantry || {}).filter(([, v]) => v > 0);
  const wood = g.wood ?? 0;
  return (
    <section className="space-y-1">
      <h3 className="font-mono text-[10px] tracking-widest text-emerald-300">THE FIELD <span className="text-gray-500 normal-case tracking-normal">· behind the house, his to cultivate</span></h3>
      <p className="text-xs text-gray-300">
        {f.crop ? <><b className="text-gray-100">{f.crop}</b>{f.gen ? ` (his own seed, generation ${f.gen})` : ''}: {FIELD_STAGE[f.stage] || f.stage}
          {f.dormant ? ', dormant in the cold' : ''}{f.stage !== 'dead' && f.health < 0.35 ? ', failing' : f.stage !== 'dead' && f.health < 0.7 ? ', struggling' : ''}
          {f.struggle.length > 0 && f.stage !== 'dead' && <span className="text-amber-300"> ({f.struggle.join(', ')})</span>}
          {f.sown ? <span className="text-gray-500"> · sown {ago(f.sown)}</span> : null}</> : <>{FIELD_STAGE[f.stage] || f.stage}</>}
        {f.scarecrow ? <span className="text-gray-400"> · scarecrow{f.scarecrow.name ? ` ${f.scarecrow.name}` : ''}{f.scarecrow.down ? ' (blown over)' : ''}</span> : null}
      </p>
      <ul className="text-[11px] text-gray-400 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <li className="flex justify-between"><span>soil moisture</span>{bar(f.water, !!f.crop && f.water < Math.max(0.1, (f.wants_water ?? 0.5) - 0.3))}</li>
        <li className="flex justify-between"><span>weeds</span>{bar(f.weeds, f.weeds > 0.4)}</li>
        <li className="flex justify-between"><span>woodpile{g.stove_lit ? ' (the stove is lit)' : ''}</span>{bar(wood, wood < 0.15)}</li>
        {g.feeder_fill !== undefined && g.design?.feeder === 'yes' && <li className="flex justify-between"><span>bird feeder</span>{bar(g.feeder_fill, g.feeder_fill < 0.1)}</li>}
      </ul>
      {f.note && <p className="text-[11px] text-gray-500">{f.note}.</p>}
      <p className="text-[11px] text-gray-400">
        Pantry: {pantry.length ? pantry.map(([k, v]) => `${v} ${PANTRY[k] || k}`).join(', ') : 'empty'}
        {f.harvests.length > 0 && <> · Harvests: {f.harvests.slice(-3).reverse().map(h => `${h.amount} ${h.unit} of ${h.crop} (${h.date})`).join('; ')}</>}
        {g.snowman ? <> · A snowman{g.snowman.name ? `, ${g.snowman.name},` : ''} stands in the yard{g.snowman.size < 0.6 ? ', melting' : ''}</> : null}
      </p>
      {g.aquarium && (
        <p className="text-[11px] text-gray-400">
          Aquarium (in the attic): {g.aquarium.fish.length ? g.aquarium.fish.map(x => `${x.name ? `${x.name}, ` : ''}a ${x.cm} cm ${x.species}${(x.health ?? 1) < 0.5 ? ' (poorly)' : ''}`).join(' · ') : 'empty; he can keep a prize fish he catches'}
          {g.aquarium.fish.length > 0 && <span className="text-gray-500"> · {g.aquarium.fed < 0.3 ? 'hungry' : 'fed'}, water {g.aquarium.clean < 0.3 ? 'murky' : g.aquarium.clean < 0.6 ? 'cloudy' : 'clear'}</span>}
        </p>
      )}
      {!f.crop && <p className="text-[11px] text-gray-500">What he can sow, and when: {Object.entries(f.crops || {}).map(([k, v]) => `${k} ${v}`).join('; ')}.</p>}
    </section>
  );
}

// the wind, as on a forecast: speed, gusts and where it comes from (mph or km/h, by the units setting)
function windText(w: Garden['weather'], units: string): string {
  const sp = w.wind ?? 0, gu = w.gust ?? sp;
  if (sp < 3 && gu < 10) return ', still';
  const v = (k: number) => (units === 'metric' ? `${Math.round(k)} km/h` : `${Math.round(k / 1.609)} mph`);
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const from = pts[Math.floor((((w.wind_dir ?? 0) + 22.5) % 360) / 45)];
  return `, wind ${from} ${v(sp)}${gu > sp + 8 ? `, gusts ${v(gu)}` : ''}${(w.gust_tomorrow ?? 0) >= 60 ? ` (gusts to ${v(w.gust_tomorrow ?? 0)} tomorrow)` : ''}`;
}
