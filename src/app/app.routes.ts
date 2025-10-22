import { Routes } from '@angular/router';
import { CurrencyConverterComponent } from './currencyConvertor/currency-converter.component';

export const routes: Routes = [
    { path: '', component: CurrencyConverterComponent },
    { path: 'currency-converter', component: CurrencyConverterComponent },
    { path: '**', redirectTo: '' }
];