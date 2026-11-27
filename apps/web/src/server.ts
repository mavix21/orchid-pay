import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { Wallet } from "@workspace/wallet/server";
import { registerSenderLanguageOnServer } from "./locale/sender-language";
import { paraglideMiddleware } from "./paraglide/server";
import { runWallet } from "./server/wallet.server";
import { attendMessage } from "./server/work.server";

const startHandler = createStartHandler(defaultStreamHandler);

registerSenderLanguageOnServer();

export default {
  fetch: (request: Request) =>
    paraglideMiddleware(request, () => startHandler(request)),
  scheduled: async () => {
    await runWallet(Wallet.use((wallet) => wallet.scheduled));
  },
  queue: async (batch: MessageBatch) => {
    for (const message of batch.messages) await attendMessage(message);
  },
};
