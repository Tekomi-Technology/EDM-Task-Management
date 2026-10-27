/**
 * Turns the ways people write Mozambican numbers into international format: "84 123 4567", "841234567",
 * "00258841234567" and "+258 84-123-4567" all become "+258841234567". Returns null for anything that is not a
 * phone number, so it is not retried forever.
 */
export function normalizePhone(raw: string, countryCode = '258'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[\s\-().]/g, '');
  let international: string;
  if (digits.startsWith('+')) international = digits.slice(1);
  else if (digits.startsWith('00')) international = digits.slice(2);
  else if (digits.startsWith(countryCode) && digits.length > 9) international = digits;
  else international = `${countryCode}${digits.replace(/^0/, '')}`;
  if (!/^\d{8,15}$/.test(international)) return null;
  return `+${international}`;
}
