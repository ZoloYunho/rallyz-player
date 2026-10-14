import QRCode from "qrcode";
import { promptPayPayload } from "@/lib/promptpay";

/** PromptPay QR with the amount filled in. Rendered on the server. */
export async function PromptPayQr({ promptpayId, amount }: { promptpayId: string; amount: number }) {
  let svg: string;
  try {
    svg = await QRCode.toString(promptPayPayload(promptpayId, amount), {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    });
  } catch {
    return null;
  }
  return (
    <div className="mx-auto w-48 rounded-xl border border-line bg-white p-2">
      <div className="mb-1 rounded-md bg-[#113566] py-1 text-center text-xs font-bold tracking-wide text-white">PromptPay</div>
      <div aria-label={`PromptPay QR code for ฿${amount}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
