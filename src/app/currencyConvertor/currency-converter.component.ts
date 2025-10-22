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
  targetLabel = 'Other Currencies';
  availableCurrencies = ['EUR', 'HKD', 'CNY', 'USD', 'JPY', 'GBP'];
  selectableCurrencies = ['HKD', 'CNY', 'USD', 'JPY', 'GBP'];
  selectedCurrencies: any = {};
  rates: any = {};
  displayRates: { label: string; value: number }[] = [];
  loading = false;
  lastUpdated: Date | null = null;
  refreshInterval: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    // Note: localStorage won't work in server-side rendering
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('selectedCurrencies');
      if (saved) {
        this.selectedCurrencies = JSON.parse(saved);
      } else {
        this.selectableCurrencies.forEach(c => this.selectedCurrencies[c] = true);
      }
    } else {
      this.selectableCurrencies.forEach(c => this.selectedCurrencies[c] = true);
    }

    this.fetchRates();
    this.refreshInterval = setInterval(() => this.fetchRates(), 60000);
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

  fetchRates() {
    this.loading = true;
    const symbols = this.selectableCurrencies.join(',');
    // Using free API without authentication
    this.http.get<any>(`https://api.fxratesapi.com/latest?base=${this.baseCurrency}&symbols=${symbols}`)
      .subscribe({
        next: (data) => {
          this.rates = data.rates;
          this.targetLabel = this.baseCurrency === 'EUR' ? '其他货币' : '欧元 (EUR)';
          this.lastUpdated = new Date();
          this.updateDisplayRates();
          this.loading = false;
        },
        error: (err) => {
          console.error('汇率获取失败', err);
          this.loading = false;
        }
      });
  }

  updateDisplayRates() {
    this.displayRates = [];
    for (const cur of this.selectableCurrencies) {
      if (this.selectedCurrencies[cur]) {
        const rate = this.baseCurrency === 'EUR' ? this.rates[cur] : 1 / this.rates[cur];
        this.displayRates.push({ label: cur, value: rate });
      }
    }
  }
}
