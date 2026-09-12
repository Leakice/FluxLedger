// Entirely fictional, deterministic demo. Fixed dates keep README screenshots reproducible.
// Existing browser data takes precedence over this first-run ledger.
const entry = (id, date, type, category, card, amount, description, extra = {}) =>
  ({ id, date, type, category, card, amount, description, ...extra });

const history = [4, 5, 6, 7, 8].flatMap((month, index) => {
  const date = day => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const id = month * 20;
  return [
    entry(id, date(1), 'income', 'Salary', '4329', 9000, 'Monthly salary'),
    entry(id + 1, date(5), 'income', 'Other', '8851', [1200, 2400, 1600, 3000, 2000][index], 'Freelance project'),
    entry(id + 2, date(2), 'expense', 'Utilities', '4329', 3200, 'Demo apartment rent'),
    entry(id + 3, date(7), 'expense', 'Food & Drinks', '4329', 380 + index * 25, 'Weekly groceries'),
    entry(id + 4, date(14), 'expense', 'Food & Drinks', '4329', 260 + index * 20, 'Dinner with friends'),
    entry(id + 5, date(9), 'expense', 'Subscription', '8851', 68, 'Music and cloud storage'),
    entry(id + 6, date(18), 'expense', 'Shopping', '8851', [450, 980, 320, 680, 560][index], 'Everyday essentials'),
    entry(id + 7, date(22), 'expense', 'Entertainment', '8851', [180, 260, 120, 420, 240][index], 'Weekend experiences'),
    entry(id + 8, date(25), 'expense', 'Other', '4329', 200, 'Transit pass'),
  ];
});

export const seed = [
  ...history,
  entry(1, '2026-08-01', 'credit', 'Other', 'credit-baitiao', 2000, 'Demo credit limit'),
  entry(2, '2026-09-01', 'credit', 'Other', 'credit-baitiao', 3000, 'Demo credit limit'),
  entry(3, '2026-09-01', 'credit', 'Other', 'credit-huabei', 1600, 'Demo credit limit'),
  entry(4, '2026-08-28', 'expense', 'Shopping', 'credit-baitiao', 1200, 'Desk and chair', { onCredit: true }),
  entry(5, '2026-09-01', 'income', 'Salary', '4329', 9000, 'Monthly salary'),
  entry(6, '2026-09-02', 'expense', 'Utilities', '4329', 2800, 'Demo apartment rent'),
  entry(7, '2026-09-03', 'income', 'Other', '8851', 2000, 'Freelance project'),
  entry(8, '2026-09-03', 'expense', 'Food & Drinks', '4329', 400, 'Weekly groceries'),
  entry(9, '2026-09-04', 'expense', 'Shopping', 'credit-baitiao', 2400, 'Demo laptop upgrade', { onCredit: true }),
  entry(10, '2026-09-04', 'expense', 'Subscription', '8851', 800, 'Annual software and cloud plan'),
  entry(11, '2026-09-03', 'repayment', 'Shopping', '4329', 1200, 'Desk paid in full', { toCard: 'credit-baitiao', purchaseId: 4 }),
  entry(12, '2026-09-05', 'expense', 'Food & Drinks', 'credit-huabei', 560, 'Dinner with friends', { onCredit: true }),
  entry(13, '2026-09-06', 'expense', 'Entertainment', '8851', 800, 'Weekend experiences'),
  entry(14, '2026-09-06', 'expense', 'Other', '4329', 800, 'Weekend train tickets'),
  entry(15, '2026-09-07', 'repayment', 'Shopping', '4329', 600, 'Laptop first repayment', { toCard: 'credit-baitiao', purchaseId: 9 }),
  entry(16, '2026-09-08', 'expense', 'Utilities', '4329', 200, 'Electricity and internet'),
  entry(17, '2026-09-08', 'repayment', 'Food & Drinks', '8851', 560, 'Dinner paid in full', { toCard: 'credit-huabei', purchaseId: 12 }),
  entry(18, '2026-09-09', 'expense', 'Shopping', 'credit-huabei', 640, 'Running shoes', { onCredit: true }),
  entry(19, '2026-09-10', 'repayment', 'Shopping', '8851', 400, 'Laptop second repayment', { toCard: 'credit-baitiao', purchaseId: 9 }),
  entry(20, '2026-09-11', 'expense', 'Food & Drinks', '4329', 760, 'Weekly groceries'),
  entry(21, '2026-09-12', 'expense', 'Entertainment', 'credit-huabei', 400, 'Museum day trip', { onCredit: true }),
];
