const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/**
 * Reads a 3-digit group (e.g. 125 -> "một trăm hai mươi lăm").
 * @param n Group value 0..999
 * @param hasHigherGroup Whether there are higher scale groups (e.g. triệu/tỷ) before this
 * @param isLowestGroup Whether this is the lowest group in the whole number
 */
function readThreeDigits(n: number, hasHigherGroup: boolean, isLowestGroup: boolean): string[] {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;
  const words: string[] = [];

  if (hundreds > 0 || hasHigherGroup) {
    words.push(DIGITS[hundreds], 'trăm');
  }

  if (tens > 1) {
    words.push(DIGITS[tens], 'mươi');
    if (units === 1) {
      words.push('mốt');
    } else if (units === 4) {
      words.push('tư');
    } else if (units === 5) {
      words.push('lăm');
    } else if (units > 0) {
      words.push(DIGITS[units]);
    }
  } else if (tens === 1) {
    words.push('mười');
    if (units === 5) {
      words.push('lăm');
    } else if (units > 0) {
      words.push(DIGITS[units]);
    }
  } else if (tens === 0) {
    if (units > 0) {
      if (hundreds > 0 || hasHigherGroup) {
        words.push('linh', DIGITS[units]);
      } else {
        words.push(DIGITS[units]);
      }
    }
  }

  return words;
}

const SCALE_UNITS = ['', 'nghìn', 'triệu', 'tỷ'];

/**
 * Converts a VND amount (number, bigint or string) into natural spoken Vietnamese text.
 * Example: 500000 -> "năm trăm nghìn đồng"
 * Example: 1250000 -> "một triệu hai trăm năm mươi nghìn đồng"
 */
export function speakVnd(rawAmount: string | number | bigint): string {
  let str = typeof rawAmount === 'string' ? rawAmount.trim() : rawAmount.toString();
  // Remove currency symbols, dots, commas, spaces
  str = str.replace(/[^\d]/g, '');

  if (!str || /^0+$/.test(str)) {
    return 'không đồng';
  }

  // Remove leading zeros
  str = str.replace(/^0+/, '');

  // Split into 3-digit groups from right to left
  const groups: number[] = [];
  while (str.length > 0) {
    const chunk = str.slice(Math.max(0, str.length - 3));
    groups.unshift(parseInt(chunk, 10));
    str = str.slice(0, Math.max(0, str.length - 3));
  }

  const resultWords: string[] = [];
  const totalGroups = groups.length;

  for (let i = 0; i < totalGroups; i++) {
    const groupVal = groups[i];
    const power = totalGroups - 1 - i;
    const hasHigher = i > 0;
    const isLowest = i === totalGroups - 1;

    if (groupVal === 0) {
      // If we are at the billions scale (multiple of 3 powers), still append "tỷ" if higher was non-zero
      if (power > 0 && power % 3 === 0 && resultWords.length > 0) {
        resultWords.push('tỷ');
      }
      continue;
    }

    const groupWords = readThreeDigits(groupVal, hasHigher, isLowest);
    resultWords.push(...groupWords);

    // Append scale unit: nghìn, triệu, tỷ, nghìn tỷ...
    if (power > 0) {
      const scaleIdx = power % 4;
      const scaleWord = SCALE_UNITS[scaleIdx];
      if (scaleWord) {
        resultWords.push(scaleWord);
      }
      // For very large numbers >= 10^12
      const tyCount = Math.floor(power / 3);
      if (scaleIdx === 0 && tyCount > 0) {
        resultWords.push('tỷ');
      }
    }
  }

  resultWords.push('đồng');
  return resultWords.join(' ');
}
