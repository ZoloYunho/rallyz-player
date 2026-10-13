/**
 * PromptPay QR payload (EMVCo merchant-presented format, Bank of Thailand).
 * Supports a mobile number (0XXXXXXXXX) or a 13-digit national/tax ID, with an
 * optional amount in baht. Any Thai banking app can scan the resulting QR.
 */

const AID = "A000000677010111";

function field(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function isValidPromptPayId(id: string): boolean {
  return /^(0\d{9}|\d{13})$/.test(id.replace(/[\s-]/g, ""));
}

export function promptPayPayload(target: string, amount?: number): string {
  const id = target.replace(/[\s-]/g, "");
  if (!isValidPromptPayId(id)) throw new Error("Invalid PromptPay ID");

  const account =
    id.length === 13
      ? field("02", id)
      : field("01", ("0000000000000" + ("66" + id.slice(1))).slice(-13));

  let payload =
    field("00", "01") +
    field("01", amount ? "12" : "11") +
    field("29", field("00", AID) + account) +
    field("58", "TH") +
    field("53", "764");
  if (amount && amount > 0) payload += field("54", amount.toFixed(2));
  payload += "6304";
  return payload + crc16(payload);
}
