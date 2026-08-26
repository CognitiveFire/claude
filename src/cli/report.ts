/** Terminal rendering of the unit-economic model. */

import { format, type Currency, type Money } from '../core/money.ts';
import type { EconomicsFigures } from '../core/economics/types.ts';

const WIDTH = 34;

function line(label: string, value: string, indent = 0): string {
  const padded = `${' '.repeat(indent)}${label}`.padEnd(WIDTH);
  return `${padded}${value.padStart(12)}`;
}

function moneyLine(label: string, value: Money, indent = 0): string {
  return line(label, format(value), indent);
}

function pct(value: number | null): string {
  return value === null ? 'UNKNOWN' : `${value.toFixed(1)}%`;
}

function ratio(value: number | null): string {
  return value === null ? 'UNKNOWN' : `${value.toFixed(2)}x`;
}

export function renderEconomics(figures: EconomicsFigures): string {
  const rows = [
    '  UNIT ECONOMICS',
    '  ' + '-'.repeat(WIDTH + 10),
    moneyLine('Retail price (inc VAT)', figures.retailPriceIncVat),
    moneyLine('Shipping charged', figures.shippingChargedIncVat),
    moneyLine('Gross revenue', figures.grossRevenueIncVat),
    moneyLine('less VAT', negated(figures.vat)),
    moneyLine('Net revenue', figures.netRevenue),
    '',
    moneyLine('Garment', negated(figures.garmentCost), 2),
    moneyLine('Printing', negated(figures.printCost), 2),
    moneyLine('Fulfilment', negated(figures.fulfilmentCost), 2),
    moneyLine('Shipping paid', negated(figures.shippingCostPaid), 2),
    moneyLine('Payment fees', negated(figures.paymentFees), 2),
    moneyLine('Platform fees', negated(figures.platformFees), 2),
    moneyLine('Returns allowance', negated(figures.returnsAllowance), 2),
    '  ' + '-'.repeat(WIDTH + 10),
    moneyLine('CONTRIBUTION BEFORE ADS', figures.contributionBeforeAdvertising),
    figures.adCostPerUnit
      ? moneyLine('less advertising', negated(figures.adCostPerUnit))
      : line('less advertising', 'UNKNOWN'),
    figures.contributionAfterAdvertising
      ? moneyLine('CONTRIBUTION AFTER ADS', figures.contributionAfterAdvertising)
      : line('CONTRIBUTION AFTER ADS', 'UNKNOWN'),
    '',
    line('Gross margin', pct(figures.grossMarginPct)),
    line('Contribution margin', pct(figures.contributionMarginPct)),
    '',
    '  ADVERTISING THRESHOLDS',
    '  ' + '-'.repeat(WIDTH + 10),
    moneyLine('Break-even CPA', figures.breakEvenCpa),
    line('Break-even ROAS', ratio(figures.breakEvenRoas)),
    moneyLine('Target CPA', figures.targetCpa),
    line('Target ROAS', ratio(figures.targetRoas)),
    figures.actualRoas === null ? null : line('Actual ROAS', ratio(figures.actualRoas)),
  ].filter((row): row is string => row !== null);

  const warnings =
    figures.warnings.length > 0
      ? ['', '  WARNINGS', ...figures.warnings.map((w) => `  ! ${wrap(w, 74, 4)}`)]
      : [];

  return [...rows, ...warnings].join('\n');
}

function negated(value: Money): Money {
  return { minor: -value.minor, currency: value.currency };
}

export function wrap(text: string, width: number, indent = 0): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current === '' ? word : `${current} ${word}`;
    }
  }
  if (current !== '') lines.push(current);
  return lines.join(`\n${' '.repeat(indent)}`);
}

export function moneyOf(minor: number, currency: Currency): Money {
  return { minor, currency };
}
