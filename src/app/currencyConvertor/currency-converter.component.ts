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
  displayRates: { label: string; value: number }[] = [];
  loading = false;
  lastUpdated: Date | null = null;
  refreshInterval: any;
  previousBaseCurrency: string | null = null;

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
      this.rates = cached.rates;
      this.lastUpdated = new Date(cached.timestamp);
      this.updateDisplayRates();
      this.rateLimitError = false;
      return;
    }

    this.loading = true;
    this.lastFetchTime = now;

    console.log(`🔄 Fetching API for ${this.baseCurrency}...`);

    try {
      const data = await this.requestRates(this.baseCurrency);
      this.rates = data.rates;
      this.lastUpdated = new Date();

      // Cache it
      this.cachedRates[cacheKey] = {
        rates: data.rates,
        timestamp: now
      };

      this.updateDisplayRates();
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
          this.rates = cached.rates;
          this.lastUpdated = new Date(cached.timestamp);
          this.updateDisplayRates();
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
        this.displayRates.push({label: cur, value: rate});
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
    this.resetSelectedCurrenciesForBase();
    console.debug("Reset Currency to EUR and Amount to 1")
    this.forceRefreshRates();
  }

  rollbackToPreviousBase() {
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

}
