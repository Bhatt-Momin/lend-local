/**
 * Display-only INR formatting helpers.
 *
 * FINANCIAL RULE: All ledger math stays on the backend in integer paise.
 * These helpers only format authoritative INR numbers for display.
 * Never use them to recompute balances or settlements.
 */

export function formatINR(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    const sign = value < 0 ? '-' : '';
    return `${sign}₹${Math.abs(value).toFixed(2)}`;
  }
}

export type BalanceTone = 'settled' | 'owed' | 'owe';

export function getBalanceTone(myBalance: number): BalanceTone {
  if (Math.abs(myBalance) < 0.01) return 'settled';
  return myBalance > 0 ? 'owed' : 'owe';
}

export function getBalanceLabel(myBalance: number): string {
  const tone = getBalanceTone(myBalance);
  if (tone === 'settled') return 'Settled up';
  if (tone === 'owed') return `You are owed ${formatINR(myBalance)}`;
  return `You owe ${formatINR(Math.abs(myBalance))}`;
}

export const BALANCE_COLORS: Record<BalanceTone, string> = {
  settled: '#10B981',
  owed: '#10B981',
  owe: '#EF4444',
};
