/**
 * Analytics synthetic data engine – ported from merchant-console.html genAnalyticsData (line 1552).
 * Generates demo sales, declines, expired links, and chargebacks.
 */
import type { Creator, Chatter, Customer, Workspace, Commission } from '../types';
import { splitSale } from '../business/splitSale';

const DAY = 86400000;
const now = Date.now();
const _sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export interface AnalyticsSale {
  creator: string;
  chatter: string;
  customer: string;
  custId: string;
  seg: string;
  amount: number;
  ts: number;
  agency: string;
  psp: number;
  margin: number;
}

export interface AnalyticsDecline {
  creator: string;
  chatter: string;
  amount: number;
  ts: number;
  agency: string;
  psp: number;
  margin: number;
}

export interface AnalyticsChargeback {
  agency: string;
  psp: number;
  margin: number;
  creator: string;
  chatter: string;
  amount: number;
  fee: number;
  model: string;
  ts: number;
}

export interface AnalyticsData {
  sales: AnalyticsSale[];
  declines: AnalyticsDecline[];
  expired: AnalyticsDecline[];
  chargebacks: AnalyticsChargeback[];
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function wpick<T>(a: T[], w: number[]): T {
  const t = _sum(w);
  let r = Math.random() * t;
  for (let i = 0; i < a.length; i++) {
    r -= w[i];
    if (r <= 0) return a[i];
  }
  return a[a.length - 1];
}

export function genAnalyticsData(
  creators: Creator[],
  chatters: Chatter[],
  customers: Customer[],
  workspaces: Workspace[],
): AnalyticsData {
  const crNames = creators.map(c => c.name);
  const chNames = chatters.map(c => c.name);
  const custs = customers.slice();
  const agencies = workspaces.slice();

  if (!crNames.length || !chNames.length || !custs.length || !agencies.length) {
    return { sales: [], declines: [], expired: [], chargebacks: [] };
  }

  const crW = crNames.map((_, i) => Math.max(1, crNames.length - i));
  const chW = chNames.map((_, i) => Math.max(1, chNames.length - i));
  const custW = custs.map((c, i) =>
    Math.max(1, custs.length - i) * (c.seg === 'VIP' ? 5 : c.seg === 'High value' ? 2 : 1),
  );
  const agW = agencies.map((_, i) => Math.max(1, agencies.length - i) * 2);

  const amt = () => {
    const r = Math.random();
    return r < 0.55
      ? Math.round(10 + Math.random() * 50)
      : r < 0.85
        ? Math.round(60 + Math.random() * 90)
        : Math.round(150 + Math.random() * 230);
  };

  const hourPool = [19, 20, 20, 21, 21, 22, 22, 22, 23, 23, 0, 1, 23, 22, 18, 21, 20, 23, 14, 12];
  const mkTs = (d: number) => {
    const x = new Date(now - d * DAY);
    x.setHours(pick(hourPool), Math.floor(Math.random() * 60), 0, 0);
    return x.getTime();
  };

  const tag = <T extends Record<string, unknown>>(o: T) => {
    const a = wpick(agencies, agW);
    return { ...o, agency: a.name, psp: +a.pspRate, margin: +a.marginRate };
  };

  const sales: AnalyticsSale[] = [];
  const declines: AnalyticsDecline[] = [];
  const expired: AnalyticsDecline[] = [];
  const chargebacks: AnalyticsChargeback[] = [];
  const N = 460;

  for (let i = 0; i < N; i++) {
    const c = wpick(custs, custW);
    sales.push(tag({
      creator: c.creator || wpick(crNames, crW),
      chatter: c.chatter || wpick(chNames, chW),
      customer: c.username,
      custId: c.id,
      seg: c.seg,
      amount: amt(),
      ts: mkTs(Math.floor(Math.pow(Math.random(), 0.75) * 90)),
    }));
  }

  for (let i = 0; i < Math.round(N * 0.15); i++) {
    declines.push(tag({
      creator: wpick(crNames, crW),
      chatter: wpick(chNames, chW),
      amount: amt(),
      ts: mkTs(Math.floor(Math.random() * 90)),
    }));
  }

  for (let i = 0; i < Math.round(N * 0.12); i++) {
    expired.push(tag({
      creator: wpick(crNames, crW),
      chatter: wpick(chNames, chW),
      amount: amt(),
      ts: mkTs(Math.floor(Math.random() * 90)),
    }));
  }

  for (let i = 0; i < Math.max(5, Math.round(N * 0.015)); i++) {
    const s = pick(sales);
    const cObj = creators.find(c => c.name === s.creator);
    const ws = workspaces.find(w => w.name === s.agency);
    chargebacks.push({
      agency: s.agency,
      psp: s.psp,
      margin: s.margin,
      creator: s.creator,
      chatter: s.chatter,
      amount: s.amount,
      fee: ws?.chargebackFee ?? 60,
      model: cObj ? cObj.revModel : 'revshare',
      ts: s.ts,
    });
  }

  return { sales, declines, expired, chargebacks };
}

// --------------- Agency payload builder (demoAgencyPayload equivalent) ---------------

export interface AgencyPayload {
  range: { days: number; fromMs: number; toMs: number };
  timeseries: Array<{ d: string; gross: number; net: number }>;
  headline: {
    gross: number; net: number; platformFee: number; hpMargin: number;
    creatorPayout: number; chatterPayout: number; agencyKeep: number;
    takeRatePct: number; aov: number; paidCount: number; uniqueBuyers: number;
  };
  chargebacks: {
    count: number; valueReversed: number; feeCost: number;
    ratePct: number; rateValuePct: number;
    byBearer: { creator: number; agency: number };
  };
  funnel: {
    created: number; paid: number; failed: number; expired: number;
    conversionPct: number; declinePct: number; expiryPct: number; revenuePerLink: number;
  };
  chatters: Array<{ name: string; revenue: number; agencyProfit: number; sales: number; conversionPct: number; aov: number }>;
  creators: Array<{ name: string; model: string; salary: number; revenue: number; creatorPayout: number; agencyProfit: number }>;
  customers: {
    avgLtv: number; arpu: number; repeatRatePct: number; freq: number;
    concentration: { top1: number; top5: number; top10: number };
    segments: Array<{ segment: string; revenue: number }>;
    newVsReturning: { newRev: number; retRev: number };
  };
  heatmap: number[][];
}

function diStr(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function buildAgencyPayload(
  analytics: AnalyticsData,
  agencyName: string,
  fromMs: number,
  toMs: number,
  creatorsList: Creator[],
  chattersList: Chatter[],
  customersList: Customer[],
  commission: Commission,
  identity: { field: 'chatter' | 'creator'; name: string } | null,
  creatorFilter: string,
  chatterFilter: string,
  blended: number,
): AgencyPayload {
  const f = (x: { agency: string; ts: number; creator?: string; chatter?: string }) =>
    x.agency === agencyName &&
    x.ts >= fromMs && x.ts <= toMs &&
    (!creatorFilter || x.creator === creatorFilter) &&
    (!chatterFilter || x.chatter === chatterFilter) &&
    (!identity || (identity.field === 'chatter' ? x.chatter : x.creator) === identity.name);

  const sales = analytics.sales.filter(f);
  const decls = analytics.declines.filter(f);
  const exp = analytics.expired.filter(f);
  const cbs = analytics.chargebacks.filter(f);

  const sp = sales.map(s => splitSale(
    { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
    creatorsList, chattersList, commission,
  ));

  const gross = _sum(sp.map(x => x.g));
  const platformFee = _sum(sp.map(x => x.platformFee));
  const net = gross - platformFee;
  const creatorTot = _sum(sp.map(x => x.creatorCut));
  const chatterTot = _sum(sp.map(x => x.chatterCut));
  const agencyTot = _sum(sp.map(x => x.agencyCut));
  const hpMargin = _sum(sp.map(x => x.margin));
  const salesN = sales.length;
  const created = salesN + decls.length + exp.length;
  const days = Math.max(1, Math.min(120, Math.round((toMs - fromMs) / DAY)));

  // Timeseries
  const platFee = (g: number) => g * blended / 100;
  const byDay: Record<string, number> = {};
  sales.forEach(s => {
    const d = diStr(s.ts);
    byDay[d] = (byDay[d] || 0) + s.amount;
  });
  const timeseries = Object.keys(byDay).sort().map(d => ({
    d,
    gross: byDay[d],
    net: byDay[d] - platFee(byDay[d]),
  }));

  // Chatters
  const chattersData = chattersList.map(c => {
    const ms = sales.filter(s => s.chatter === c.name);
    const mc = ms.length + decls.filter(d => d.chatter === c.name).length + exp.filter(e => e.chatter === c.name).length;
    const rev = _sum(ms.map(s => s.amount));
    const msSp = ms.map(s => splitSale(
      { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
      creatorsList, chattersList, commission,
    ));
    return {
      name: c.name,
      revenue: rev,
      agencyProfit: _sum(msSp.map(x => x.agencyCut)),
      sales: ms.length,
      conversionPct: mc ? Math.round(ms.length / mc * 100) : 0,
      aov: ms.length ? rev / ms.length : 0,
    };
  }).filter(r => r.revenue > 0 || !identity).sort((a, b) => b.revenue - a.revenue);

  // Creators
  const creatorsData = creatorsList.map(c => {
    const ms = sales.filter(s => s.creator === c.name).map(s => splitSale(
      { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
      creatorsList, chattersList, commission,
    ));
    const rev = _sum(ms.map(x => x.g));
    return {
      name: c.name,
      model: c.revModel,
      salary: +(c.salary || 0),
      revenue: rev,
      creatorPayout: _sum(ms.map(x => x.creatorCut)),
      agencyProfit: _sum(ms.map(x => x.agencyCut)),
    };
  }).filter(p => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);

  // Customers
  const avg = (a: number[]) => a.length ? _sum(a) / a.length : 0;
  const byCust: Record<string, number> = {};
  sales.forEach(s => { byCust[s.custId] = (byCust[s.custId] || 0) + s.amount; });
  const cvals = Object.values(byCust).sort((a, b) => b - a);
  const tot = _sum(cvals) || 1;
  const topShare = (pp: number) => {
    const n = Math.max(1, Math.ceil(cvals.length * pp));
    return Math.round(_sum(cvals.slice(0, n)) / tot * 100);
  };

  const bySeg: Record<string, number> = {};
  sales.forEach(s => { bySeg[s.seg || 'New'] = (bySeg[s.seg || 'New'] || 0) + s.amount; });
  const segments = Object.entries(bySeg).sort((a, b) => b[1] - a[1]).map(([segment, revenue]) => ({ segment, revenue }));

  const seen: Record<string, boolean> = {};
  let newRev = 0, retRev = 0;
  [...sales].sort((a, b) => a.ts - b.ts).forEach(s => {
    if (seen[s.custId]) retRev += s.amount;
    else { seen[s.custId] = true; newRev += s.amount; }
  });

  // Chargebacks
  const cbGross = _sum(cbs.map(c => c.amount));
  const cbCost = _sum(cbs.map(c => c.fee));
  let creatorBorne = 0, agencyBorne = 0;
  cbs.forEach(c => {
    const s = splitSale(
      { amount: c.amount, creator: c.creator, psp: c.psp, margin: c.margin },
      creatorsList, chattersList, commission,
    );
    if (c.model === 'revshare') {
      creatorBorne += s.creatorCut + c.fee;
      agencyBorne += s.agencyCut;
    } else {
      agencyBorne += s.dist + c.fee;
    }
  });

  // Heatmap
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  sales.forEach(s => {
    const d = new Date(s.ts);
    grid[d.getDay()][d.getHours()] += s.amount;
  });

  return {
    range: { days, fromMs, toMs },
    timeseries,
    headline: {
      gross, net, platformFee, hpMargin,
      creatorPayout: creatorTot, chatterPayout: chatterTot, agencyKeep: agencyTot,
      takeRatePct: gross ? +(agencyTot / gross * 100).toFixed(1) : 0,
      aov: salesN ? +(gross / salesN).toFixed(2) : 0,
      paidCount: salesN,
      uniqueBuyers: new Set(sales.map(s => s.custId)).size,
    },
    chargebacks: {
      count: cbs.length,
      valueReversed: cbGross,
      feeCost: cbCost,
      ratePct: salesN ? +(cbs.length / salesN * 100).toFixed(2) : 0,
      rateValuePct: gross ? +(cbGross / gross * 100).toFixed(2) : 0,
      byBearer: { creator: creatorBorne, agency: agencyBorne },
    },
    funnel: {
      created, paid: salesN, failed: decls.length, expired: exp.length,
      conversionPct: created ? Math.round(salesN / created * 100) : 0,
      declinePct: created ? Math.round(decls.length / created * 100) : 0,
      expiryPct: created ? Math.round(exp.length / created * 100) : 0,
      revenuePerLink: created ? +(gross / created).toFixed(2) : 0,
    },
    chatters: chattersData,
    creators: creatorsData,
    customers: {
      avgLtv: avg(customersList.map(c => c.spend)),
      arpu: customersList.length ? _sum(customersList.map(c => c.spend)) / customersList.length : 0,
      repeatRatePct: customersList.length ? Math.round(customersList.filter(c => c.purchases >= 2).length / customersList.length * 100) : 0,
      freq: customersList.length ? +(_sum(customersList.map(c => c.purchases)) / customersList.length).toFixed(1) : 0,
      concentration: { top1: topShare(0.01), top5: topShare(0.05), top10: topShare(0.10) },
      segments,
      newVsReturning: { newRev, retRev },
    },
    heatmap: grid,
  };
}

// --------------- Platform payload builder (renderPlatformAnalytics equivalent) ---------------

export interface PlatformPayload {
  totalVolume: number;
  hpMargin: number;
  activeAgencies: number;
  avgBlended: number;
  netToAgencies: number;
  cbRatePct: number;
  timeseries: Array<{ d: string; gross: number }>;
  agencies: Array<{ agency: string; volume: number; blended: number; hpMargin: number; sales: number; cbRatePct: number }>;
}

export function buildPlatformPayload(
  analytics: AnalyticsData,
  fromMs: number,
  toMs: number,
  creatorsList: Creator[],
  chattersList: Chatter[],
  commission: Commission,
): PlatformPayload {
  const inW = (x: { ts: number }) => x.ts >= fromMs && x.ts <= toMs;
  const sales = analytics.sales.filter(inW);
  const cbs = analytics.chargebacks.filter(inW);
  const sp = sales.map(s => splitSale(
    { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
    creatorsList, chattersList, commission,
  ));

  const total = _sum(sp.map(x => x.g));
  const margin = _sum(sp.map(x => x.margin));
  const net = _sum(sp.map(x => x.dist));

  const byAg: Record<string, { vol: number; margin: number; sales: number; blended: number; cb: number }> = {};
  sales.forEach((s, i) => {
    const a = byAg[s.agency] = byAg[s.agency] || { vol: 0, margin: 0, sales: 0, blended: sp[i].blended, cb: 0 };
    a.vol += s.amount;
    a.margin += sp[i].margin;
    a.sales++;
  });
  cbs.forEach(c => { if (byAg[c.agency]) byAg[c.agency].cb++; });

  const agList = Object.entries(byAg).sort((a, b) => b[1].vol - a[1].vol);

  const byDay: Record<string, number> = {};
  sales.forEach(s => {
    const d = diStr(s.ts);
    byDay[d] = (byDay[d] || 0) + s.amount;
  });
  const timeseries = Object.keys(byDay).sort().map(d => ({ d, gross: byDay[d] }));

  return {
    totalVolume: total,
    hpMargin: margin,
    activeAgencies: agList.length,
    avgBlended: agList.length ? _sum(agList.map(([, a]) => a.blended)) / agList.length : 0,
    netToAgencies: net,
    cbRatePct: sales.length ? +(cbs.length / sales.length * 100).toFixed(2) : 0,
    timeseries,
    agencies: agList.map(([name, a]) => ({
      agency: name,
      volume: a.vol,
      blended: a.blended,
      hpMargin: a.margin,
      sales: a.sales,
      cbRatePct: a.sales ? +((a.cb / a.sales * 100).toFixed(2)) : 0,
    })),
  };
}
