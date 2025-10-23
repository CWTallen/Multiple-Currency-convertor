import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  availableCurrencies = ['EUR', 'HKD', 'CNY', 'USD', 'JPY', 'GBP'];
  selectedCurrencies: any = {};
  rates: any = {};
  displayRates: { label: string; value: number }[] = [];
  loading = false;
  lastUpdated: Date | null = null;
  refreshInterval: any;
  
  // Rate limiting and caching
  private lastFetchTime: number = 0;
  private readonly MIN_FETCH_INTERVAL = 10000; // 10 seconds minimum between requests
  private readonly CACHE_DURATION = 300000; // 5 minutes cache duration
  private cachedRates: { [key: string]: { rates: any; timestamp: number } } = {};
  rateLimitError = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    // Note: localStorage won't work in server-side rendering
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('selectedCurrencies');
      if (saved) {
        this.selectedCurrencies = JSON.parse(saved);
      } else {
        // Initialize with all currencies except the base currency selected
        this.availableCurrencies.forEach(c => {
          this.selectedCurrencies[c] = c !== this.baseCurrency;
        });
      }
    } else {
      this.availableCurrencies.forEach(c => {
        this.selectedCurrencies[c] = c !== this.baseCurrency;
      });
    }

    this.fetchRates();
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
    // When base currency changes, update selected currencies to exclude the new base
    this.availableCurrencies.forEach(c => {
      if (c === this.baseCurrency) {
        this.selectedCurrencies[c] = false; // Don't show base currency as target
      } else if (!(c in this.selectedCurrencies)) {
        this.selectedCurrencies[c] = true; // Add new currencies if they don't exist
      }
    });
    this.saveSelectedCurrencies();
    this.fetchRates();
  }

  fetchRates() {
    const now = Date.now();
    
    // Check if we're hitting rate limits
    if (now - this.lastFetchTime < this.MIN_FETCH_INTERVAL) {
      console.log('Rate limit: Too many requests, skipping fetch');
      return;
    }
    
    // Check cache first
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
    
    // Get all currencies except the base currency as symbols
    const symbols = this.availableCurrencies.filter(c => c !== this.baseCurrency).join(',');
    
    // Using free API without authentication
    this.http.get<any>(`https://api.fxratesapi.com/latest?base=${this.baseCurrency}&symbols=${symbols}`)
      .subscribe({
        next: (data) => {
          this.rates = data.rates;
          this.lastUpdated = new Date();
          
          // Cache the rates
          this.cachedRates[cacheKey] = {
            rates: data.rates,
            timestamp: now
          };
          
          this.updateDisplayRates();
          this.loading = false;
          this.rateLimitError = false;
        },
        error: (err) => {
          console.error('汇率获取失败', err);
          this.loading = false;
          
          // Check if it's a rate limit error
          if (err.status === 429 || err.status === 403) {
            this.rateLimitError = true;
            console.warn('Rate limit exceeded. Using cached data if available.');
            
            // Try to use cached data if available
            if (cached) {
              this.rates = cached.rates;
              this.lastUpdated = new Date(cached.timestamp);
              this.updateDisplayRates();
            }
          }
        }
      });
  }

  updateDisplayRates() {
    this.displayRates = [];
    for (const cur of this.availableCurrencies) {
      if (this.selectedCurrencies[cur] && cur !== this.baseCurrency) {
        // The API returns rates from base currency to target currency
        // So if base is EUR and target is USD, rate is EUR/USD
        const rate = this.rates[cur];
        this.displayRates.push({ label: cur, value: rate });
      }
    }
  }

  // Force refresh rates (bypasses rate limiting for manual refresh)
  forceRefreshRates() {
    this.lastFetchTime = 0; // Reset rate limit timer
    this.fetchRates();
  }
}
