/**
 * One-off helper: prints the WhatsApp group ids the linked account can see,
 * so the right value for WHATSAPP_GROUP_ID can be copied out.
 *
 *   GREENAPI_ID_INSTANCE=... GREENAPI_API_TOKEN=... pnpm find-group potpod
 */

import { listChats } from "../whatsapp.js";

const nameFilter = (process.argv[2] ?? "potpod").toLowerCase();

async function main(): Promise<void> {
  const instanceId = process.env["GREENAPI_ID_INSTANCE"];
  const token = process.env["GREENAPI_API_TOKEN"];
  if (instanceId === undefined || token === undefined) {
    throw new Error("Set GREENAPI_ID_INSTANCE and GREENAPI_API_TOKEN first.");
  }

  const chats = await listChats({
    baseUrl: process.env["GREENAPI_BASE_URL"] ?? "https://api.green-api.com",
    instanceId,
    token,
  });

  const groups = chats.filter((chat) => chat.id.endsWith("@g.us"));
  console.log(`${groups.length} Gruppen gefunden:\n`);

  for (const group of groups) {
    const name = group.name ?? "(kein Name)";
    const hit = name.toLowerCase().includes(nameFilter) ? "  <-- das ist sie" : "";
    console.log(`  ${group.id}   ${name}${hit}`);
  }

  if (groups.length === 0) {
    console.log(
      "Keine Gruppen sichtbar. Green API liefert Chats erst, wenn das Handy einmal\n" +
        "synchronisiert hat — kurz warten und erneut versuchen.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
