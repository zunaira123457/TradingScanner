import { Trade, ExitReason, BacktestConfig } from '@/types/backtest';
import { applyEntrySlippage, applyExitSlippage, calculateCommission } from './Execution';

/**
 * Owns cash and open positions, and is the single place that applies
 * slippage/commissions and computes P&L — keeping that accounting in one
 * spot avoids double-applying costs across the engine.
 */
export class Portfolio {
  cash: number;
  openPositions: Map<string, Trade> = new Map();
  private idCounter = 0;

  constructor(startingCapital: number) {
    this.cash = startingCapital;
  }

  getMarketValue(latestPrices: Map<string, number>): number {
    let value = 0;
    for (const [ticker, trade] of this.openPositions) {
      const price = latestPrices.get(ticker) ?? trade.entryPrice;
      value += trade.shares * price;
    }
    return value;
  }

  getEquity(latestPrices: Map<string, number>): number {
    return this.cash + this.getMarketValue(latestPrices);
  }

  getExposurePct(latestPrices: Map<string, number>): number {
    const equity = this.getEquity(latestPrices);
    return equity <= 0 ? 0 : this.getMarketValue(latestPrices) / equity;
  }

  /**
   * Checks position-count, cash, portfolio-exposure, and (if a sector map
   * was configured) sector-exposure limits. Sector exposure is a no-op
   * (always passes) when no sectorMap/maxSectorExposurePct is configured —
   * documented in BacktestConfig rather than silently pretending to enforce
   * a constraint the caller never supplied data for.
   */
  canOpenPosition(
    ticker: string,
    estimatedCost: number,
    config: BacktestConfig,
    latestPrices: Map<string, number>
  ): boolean {
    if (this.openPositions.has(ticker)) return false;
    if (this.openPositions.size >= config.maxPositions) return false;
    if (estimatedCost > this.cash) return false;

    const equity = this.getEquity(latestPrices);
    if (equity <= 0) return false;

    const projectedInvested = this.getMarketValue(latestPrices) + estimatedCost;
    if (projectedInvested / equity > config.maxPortfolioExposurePct) return false;

    if (config.sectorMap && config.maxSectorExposurePct !== undefined) {
      const sector = config.sectorMap.get(ticker);
      if (sector) {
        let sectorValue = estimatedCost;
        for (const [t, trade] of this.openPositions) {
          if (config.sectorMap.get(t) === sector) {
            sectorValue += trade.shares * (latestPrices.get(t) ?? trade.entryPrice);
          }
        }
        if (sectorValue / equity > config.maxSectorExposurePct) return false;
      }
    }

    return true;
  }

  openPosition(params: {
    ticker: string;
    strategy: string;
    signalDate: Date;
    entryDate: Date;
    intendedEntryPrice: number;
    shares: number;
    stopPrice: number;
    targetPrice: number;
    signalScore: number;
    marketRegimeAtEntry: string | null;
    slippageBps: number;
    commissionBps: number;
  }): Trade {
    const entryPrice = applyEntrySlippage(params.intendedEntryPrice, params.slippageBps);
    const notional = entryPrice * params.shares;
    const commission = calculateCommission(notional, params.commissionBps);

    this.cash -= notional + commission;

    const trade: Trade = {
      id: `T${++this.idCounter}`,
      ticker: params.ticker,
      strategy: params.strategy,
      signalDate: params.signalDate,
      entryDate: params.entryDate,
      entryPrice,
      shares: params.shares,
      stopPrice: params.stopPrice,
      targetPrice: params.targetPrice,
      exitDate: null,
      exitPrice: null,
      exitReason: null,
      grossPnl: null,
      fees: commission,
      slippageCost: (entryPrice - params.intendedEntryPrice) * params.shares,
      netPnl: null,
      rMultiple: null,
      signalScore: params.signalScore,
      marketRegimeAtEntry: params.marketRegimeAtEntry,
      status: 'open',
    };

    this.openPositions.set(params.ticker, trade);
    return trade;
  }

  closePosition(
    ticker: string,
    intendedExitPrice: number,
    exitDate: Date,
    exitReason: ExitReason,
    slippageBps: number,
    commissionBps: number
  ): Trade {
    const trade = this.openPositions.get(ticker);
    if (!trade) {
      throw new Error(`No open position for ${ticker}`);
    }

    const exitPrice = applyExitSlippage(intendedExitPrice, slippageBps);
    const notional = exitPrice * trade.shares;
    const commission = calculateCommission(notional, commissionBps);

    this.cash += notional - commission;

    const grossPnl = (exitPrice - trade.entryPrice) * trade.shares;
    const totalFees = trade.fees + commission;
    const netPnl = grossPnl - totalFees;
    const riskPerShare = trade.entryPrice - trade.stopPrice;
    const rMultiple = riskPerShare > 0 ? netPnl / (riskPerShare * trade.shares) : null;

    trade.exitDate = exitDate;
    trade.exitPrice = exitPrice;
    trade.exitReason = exitReason;
    trade.grossPnl = grossPnl;
    trade.fees = totalFees;
    trade.slippageCost += (intendedExitPrice - exitPrice) * trade.shares;
    trade.netPnl = netPnl;
    trade.rMultiple = rMultiple;
    trade.status = 'closed';

    this.openPositions.delete(ticker);
    return trade;
  }
}
