import { address } from "@solana/kit";
import * as Schema from "effect/Schema";
import { Asset } from "../contract";
import type { RecordNetwork } from "../record-network";
import { epochAt, network } from "./network";

export const solanaRecordNetwork: RecordNetwork = {
  network,
  epochAt,
  assetColumns: ({ id, code }) => ({ code, issuer: address(id) }),
  assetFromColumns: ({ code, issuer }) =>
    Schema.decodeSync(Asset)({ id: address(issuer), code }),
};
