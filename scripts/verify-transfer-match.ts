/**
 * One-off verification: run the transfer matcher over the whole DB and print
 * the result. Run with: `npx tsx scripts/verify-transfer-match.ts`
 *
 * Idempotent — only pairs unpaired rows, so safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { pairTransfersInWindow } from "@/lib/transfer-match";

async function main() {
  console.log("Running pairTransfersInWindow over the full table…");
  const result = await pairTransfersInWindow({});
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
