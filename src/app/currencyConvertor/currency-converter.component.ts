import {Component, OnInit, OnDestroy} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-currency-converter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './currency-converter.component.html',
  styleUrl: './currency-converter.component.scss'
})
export class CurrencyConverterComponent implements OnInit, OnDestroy {
  amount = 1;
  baseCurrency = 'EUR';
  availableCurrencies = ['EUR', 'HKD', 'CNY', 'USD', 'JPY', 'GBP', 'CHF'];
  selectedCurrencies: any = {};
  rates: any = {};
  previousRates: any = {};
  private ratesBase: string | null = null;
  displayRates: { label: string; value: number; trend: 'up' | 'down' | 'flat' }[] = [];
  loading = false;
  lastUpdated: Date | null = null;
  refreshInterval: any;
  previousBaseCurrency: string | null = null;

  // Historical chart state
  chartCurrency: string | null = null;
  chartLoading = false;
  chartError = false;
  chartPoints: { date: string; value: number }[] = [];

  // Rate limiting and caching
  private lastFetchTime: number = 0;
  private readonly MIN_FETCH_INTERVAL = 5000; // 10 seconds minimum between requests
  private readonly CACHE_DURATION = 300000; // 5 minutes cache duration
  private cachedRates: { [key: string]: { rates: any; timestamp: number } } = {};
  rateLimitError = false;
  private preloadInProgress = false;

  constructor(private http: HttpClient) {
  }

  ngOnInit() {
    this.previousBaseCurrency = this.baseCurrency;
    // Note: localStorage won't work in server-side rendering
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('selectedCurrencies');
      if (saved) {
        this.selectedCurrencies = JSON.parse(saved);
      } else {
        this.resetSelectedCurrenciesForBase();
      }
    } else {
      this.resetSelectedCurrenciesForBase();
    }

    this.fetchRates();
    this.preloadAllRates();
    // Increased refresh interval to 5 minutes to respect rate limits
    this.refreshInterval = setInterval(() => this.fetchRates(), 300000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  saveSelectedCurrencies() {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('selectedCurrencies', JSON.stringify(this.selectedCurrencies));
    }
    this.updateDisplayRates();
  }

  onBaseCurrencyChange() {
    this.chartCurrency = null; // history chart is relative to the old base
    // If there was a previous base, re-check it
    if (this.previousBaseCurrency && this.previousBaseCurrency !== this.baseCurrency) {
      this.selectedCurrencies[this.previousBaseCurrency] = true;
    }
    // When base currency changes, update selected currencies to exclude the new base
    this.availableCurrencies.forEach(c => {
      if (c === this.baseCurrency) {
        this.selectedCurrencies[c] = false; // Don't show base currency as target
      } else if (!(c in this.selectedCurrencies)) {
        this.selectedCurrencies[c] = true; // Add new currencies if they don't exist
      }
    });
    this.previousBaseCurrency = this.baseCurrency;

    this.saveSelectedCurrencies();
    this.fetchRates();
    this.preloadAllRates();
  }

  async preloadAllRates() {
    // Guard against overlapping runs (e.g. rapid base-currency switching)
    if (this.preloadInProgress) {
      console.log('⏭️ Preload already in progress, skipping.');
      return;
    }
    this.preloadInProgress = true;
    console.log('🚀 Starting background rate preload...');
    const originalBase = this.baseCurrency;

    try {
      for (const currency of this.availableCurrencies) {
        if (currency === originalBase) continue; // skip current base

        // Abort if the user switched base again; a fresh preload will take over
        if (this.baseCurrency !== originalBase) {
          console.log('⏭️ Base currency changed, aborting stale preload.');
          break;
        }

        // Skip if already cached recently
        const cached = this.cachedRates[currency];
        const now = Date.now();
        if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
          console.log(`✅ Skipping ${currency}, already cached.`);
          continue;
        }

        try {
          console.log(`🔄 Preloading rates for base: ${currency}`);
          await this.fetchAndCacheRates(currency);
          await this.delay(6000); // small gap to avoid API throttling
        } catch (err) {
          console.warn(`⚠️ Failed to preload ${currency}:`, err);
        }
      }

      console.log('✅ Preloading finished.');
    } finally {
      this.preloadInProgress = false;
    }
  }

  // Raw API call shared by fetchRates() and fetchAndCacheRates()
  private requestRates(base: string): Promise<any> {
    const symbols = this.availableCurrencies.filter(c => c !== base).join(',');
    return new Promise((resolve, reject) => {
      this.http
        .get<any>(`https://api.fxratesapi.com/latest?base=${base}&symbols=${symbols}`)
        .subscribe({next: resolve, error: reject});
    });
  }

  async fetchAndCacheRates(base: string): Promise<void> {
    const now = Date.now();
    const data = await this.requestRates(base);
    this.cachedRates[base] = {
      rates: data.rates,
      timestamp: now
    };
    console.log(`✅ Cached rates for ${base}`);
  }

  // Simple helper for async delay
  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Applies a fresh set of rates and remembers the prior set for trend comparison.
  // Trend is only meaningful when comparing rates for the same base currency,
  // so a base switch starts the trend indicator fresh.
  private applyRates(newRates: any, updated: Date, forBase: string): void {
    this.previousRates = this.ratesBase === forBase ? this.rates : {};
    this.rates = newRates;
    this.ratesBase = forBase;
    this.lastUpdated = updated;
    this.updateDisplayRates();
  }

  async fetchRates(): Promise<void> {
    const now = Date.now();

    // Check rate limit
    if (now - this.lastFetchTime < this.MIN_FETCH_INTERVAL) {
      console.log('Rate limit: Too many requests, skipping fetch');
      return;
    }

    const cacheKey = this.baseCurrency;
    const cached = this.cachedRates[cacheKey];
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
      console.log('Using cached rates');
      this.applyRates(cached.rates, new Date(cached.timestamp), cacheKey);
      this.rateLimitError = false;
      return;
    }

    this.loading = true;
    this.lastFetchTime = now;

    console.log(`🔄 Fetching API for ${this.baseCurrency}...`);

    try {
      const data = await this.requestRates(this.baseCurrency);
      this.applyRates(data.rates, new Date(), cacheKey);

      // Cache it
      this.cachedRates[cacheKey] = {
        rates: data.rates,
        timestamp: now
      };

      this.loading = false;
      this.rateLimitError = false;

      console.log(`✅ Rates loaded for ${this.baseCurrency}`);
    } catch (err: any) {
      console.error('❌ 汇率获取失败', err);
      this.loading = false;

      if (err.status === 429 || err.status === 403) {
        this.rateLimitError = true;
        console.warn('Rate limit exceeded. Using cached data if available.');
        if (cached) {
          this.applyRates(cached.rates, new Date(cached.timestamp), cacheKey);
        }
      }
      if (this.previousBaseCurrency && this.previousBaseCurrency !== this.baseCurrency) {
        console.warn(`⚠️ Rolling back from ${this.baseCurrency} to ${this.previousBaseCurrency}`);

        const failedCurrency = this.baseCurrency; // remember the failed one
        this.rollbackToPreviousBase(); // revert selection/UI state

        // Notify user (replace with toast if preferred)
        alert(`无法获取 ${failedCurrency} 的汇率，已回滚到 ${this.previousBaseCurrency}。正在重试...`);

        // Try one retry after rollback
        try {
          await this.fetchRates();
          console.log(`✅ Retry succeeded after rollback to ${this.previousBaseCurrency}`);
          return;
        } catch (retryErr) {
          console.error(`❌ Retry failed again for ${this.previousBaseCurrency}`, retryErr);
          alert(`重试失败，请检查网络或API限制。`);
        }
      }

      throw err;
    }
  }

  updateDisplayRates() {
    this.displayRates = [];
    for (const cur of this.availableCurrencies) {
      if (this.selectedCurrencies[cur] && cur !== this.baseCurrency) {
        // The API returns rates from base currency to target currency
        // So if base is EUR and target is USD, rate is EUR/USD
        const rate = this.rates[cur];
        const previous = this.previousRates[cur];
        let trend: 'up' | 'down' | 'flat' = 'flat';
        if (typeof rate === 'number' && typeof previous === 'number') {
          if (rate > previous) trend = 'up';
          else if (rate < previous) trend = 'down';
        }
        this.displayRates.push({label: cur, value: rate, trend});
      }
    }
  }

  // Force refresh rates (bypasses rate limiting for manual refresh)
  forceRefreshRates() {
    this.lastFetchTime = 0; // Reset rate limit timer
    this.fetchRates();
  }

  resetButton() {
    this.baseCurrency = 'EUR';
    this.amount = 1;
    this.chartCurrency = null;
    this.resetSelectedCurrenciesForBase();
    console.debug("Reset Currency to EUR and Amount to 1")
    this.forceRefreshRates();
  }

  rollbackToPreviousBase() {
    this.chartCurrency = null;
    if (this.previousBaseCurrency) {
      console.log(`↩️ Rolling back to ${this.previousBaseCurrency}`);
      this.baseCurrency = this.previousBaseCurrency;

      // Re-enable previous base
      this.resetSelectedCurrenciesForBase();
    }

    // Notify user
    alert(`无法获取 ${this.baseCurrency} 的汇率，已回滚到 ${this.previousBaseCurrency || '上一个币种'}。`);
  }

  private resetSelectedCurrenciesForBase(): void {
    this.availableCurrencies.forEach(c => {
      this.selectedCurrencies[c] = c !== this.baseCurrency;
    });
  }

  async retryFetchRates() {
    console.log(`🔁 Retrying fetch for ${this.baseCurrency}...`);
    try {
      await this.fetchRates();
      console.log('✅ Retry succeeded!');
    } catch (retryErr) {
      console.error('❌ Retry also failed.', retryErr);
      alert(`重试获取 ${this.baseCurrency} 汇率失败，请检查网络或API连接。`);
    }
  }

  toggleCurrency(cur: string): void {
    if (cur === this.baseCurrency) return; // ignore disabled
    this.selectedCurrencies[cur] = !this.selectedCurrencies[cur];
    this.saveSelectedCurrencies();
  }

  // Makes a displayed target currency the new base, and puts the old base back as a target
  swapToBase(cur: string): void {
    if (cur === this.baseCurrency) return;
    this.baseCurrency = cur;
    this.onBaseCurrencyChange();
  }

  // Toggles a 30-day historical rate chart for a target currency against the current base
  async toggleHistoryChart(cur: string): Promise<void> {
    if (this.chartCurrency === cur) {
      this.chartCurrency = null;
      return;
    }

    this.chartCurrency = cur;
    this.chartLoading = true;
    this.chartError = false;
    this.chartPoints = [];

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    try {
      const data = await this.requestHistory(this.baseCurrency, cur, fmt(start), fmt(end));
      this.chartPoints = Object.entries<any>(data.rates)
        .map(([date, rates]) => ({date, value: rates[cur]}))
        .filter(p => typeof p.value === 'number')
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      console.warn(`⚠️ Failed to load history for ${cur}:`, err);
      this.chartError = true;
    } finally {
      this.chartLoading = false;
    }
  }

  private requestHistory(base: string, cur: string, startDate: string, endDate: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.http
        .get<any>(`https://api.fxratesapi.com/timeseries?base=${base}&currencies=${cur}&start_date=${startDate}&end_date=${endDate}`)
        .subscribe({next: resolve, error: reject});
    });
  }

  // History chart geometry: a fixed viewBox with margins reserved for axis labels
  readonly chartWidth = 320;
  readonly chartHeight = 130;
  readonly chartMargin = {left: 45, right: 10, top: 10, bottom: 24};

  get chartPlotWidth(): number {
    return this.chartWidth - this.chartMargin.left - this.chartMargin.right;
  }

  get chartPlotHeight(): number {
    return this.chartHeight - this.chartMargin.top - this.chartMargin.bottom;
  }

  private get chartValueRange(): { min: number; max: number } {
    const values = this.chartPoints.map(p => p.value);
    return {min: Math.min(...values), max: Math.max(...values)};
  }

  // SVG polyline points for the history chart, plotted within the margin box
  get chartPolylinePoints(): string {
    if (this.chartPoints.length < 2) return '';

    const {min, max} = this.chartValueRange;
    const range = max - min || 1;
    const {left, top} = this.chartMargin;
    const plotWidth = this.chartPlotWidth;
    const plotHeight = this.chartPlotHeight;
    const step = plotWidth / (this.chartPoints.length - 1);

    return this.chartPoints
      .map((p, i) => {
        const x = left + i * step;
        const y = top + plotHeight - ((p.value - min) / range) * plotHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  // Y-axis ticks at the min, midpoint, and max rate
  get chartYAxisTicks(): { y: number; label: string }[] {
    if (this.chartPoints.length < 2) return [];

    const {min, max} = this.chartValueRange;
    const mid = (min + max) / 2;
    const {top} = this.chartMargin;
    const plotHeight = this.chartPlotHeight;
    const toY = (v: number) => top + plotHeight - ((v - min) / (max - min || 1)) * plotHeight;

    return [
      {y: toY(max), label: max.toFixed(4)},
      {y: toY(mid), label: mid.toFixed(4)},
      {y: toY(min), label: min.toFixed(4)},
    ];
  }

  // X-axis ticks at the first, middle, and last date in the range
  get chartXAxisTicks(): { x: number; label: string }[] {
    if (this.chartPoints.length < 2) return [];

    const {left} = this.chartMargin;
    const plotWidth = this.chartPlotWidth;
    const lastIndex = this.chartPoints.length - 1;
    const step = plotWidth / lastIndex;
    const midIndex = Math.round(lastIndex / 2);
    const shortDate = (iso: string) => iso.slice(5, 10); // MM-DD

    const indices = Array.from(new Set([0, midIndex, lastIndex]));
    return indices.map(i => ({x: left + i * step, label: shortDate(this.chartPoints[i].date)}));
  }

}
