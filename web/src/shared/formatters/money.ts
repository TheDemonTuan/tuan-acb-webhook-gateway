export function formatVndCurrency(amount: number | bigint | string): string {
  let num: number;
  if (typeof amount === 'string') {
    const cleaned = amount.replace(/[^\d.-]/g, '');
    num = parseFloat(cleaned) || 0;
  } else {
    num = Number(amount);
  }

  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatVndCompact(amount: number | bigint | string): string {
  let num: number;
  if (typeof amount === 'string') {
    const cleaned = amount.replace(/[^\d.-]/g, '');
    num = parseFloat(cleaned) || 0;
  } else {
    num = Number(amount);
  }

  if (Math.abs(num) >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)} tỷ ₫`;
  }
  if (Math.abs(num) >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)} tr ₫`;
  }
  if (Math.abs(num) >= 1_000) {
    return `${(num / 1_000).toFixed(0)} k ₫`;
  }
  return `${num.toLocaleString('vi-VN')} ₫`;
}
