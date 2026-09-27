import { vi } from 'vitest';

/** Recording double for lightweight-charts (canvas can't render in jsdom). */
export interface MockSeries {
  type: string;
  pane: number;
  opts: unknown;
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
}
export interface MockChart {
  series: MockSeries[];
  removed: boolean;
  crosshair: ((p: unknown) => void) | null;
  timeScaleApi: { setVisibleLogicalRange: ReturnType<typeof vi.fn>; fitContent: ReturnType<typeof vi.fn> };
  applyOptions: ReturnType<typeof vi.fn>;
}
export const charts: MockChart[] = [];
export const markerSets: unknown[][] = [];

export const CandlestickSeries = 'Candlestick';
export const HistogramSeries = 'Histogram';
export const LineSeries = 'Line';
export const ColorType = { Solid: 'solid' };
export const CrosshairMode = { Normal: 0 };
export const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2 };

export function createChart() {
  let panes = 1;
  const state: MockChart = {
    series: [],
    removed: false,
    crosshair: null,
    timeScaleApi: { setVisibleLogicalRange: vi.fn(), fitContent: vi.fn() },
    applyOptions: vi.fn(),
  };
  charts.push(state);
  const pane = () => ({ setStretchFactor: vi.fn() });
  return {
    addSeries(type: string, opts: unknown, paneIndex = 0) {
      panes = Math.max(panes, paneIndex + 1);
      const s: MockSeries = { type, pane: paneIndex, opts, setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn((o) => o), removePriceLine: vi.fn() };
      state.series.push(s);
      return s;
    },
    removeSeries(s: MockSeries) {
      state.series = state.series.filter((x) => x !== s);
    },
    panes: () => Array.from({ length: panes }, pane),
    removePane: () => void (panes = Math.max(1, panes - 1)),
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => state.timeScaleApi,
    applyOptions: state.applyOptions,
    subscribeCrosshairMove: (h: (p: unknown) => void) => void (state.crosshair = h),
    unsubscribeCrosshairMove: () => void (state.crosshair = null),
    remove: () => void (state.removed = true),
  };
}

export function createSeriesMarkers() {
  return { setMarkers: (m: unknown[]) => markerSets.push(m) };
}

export function resetCharts() {
  charts.length = 0;
  markerSets.length = 0;
}
