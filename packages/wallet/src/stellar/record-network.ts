import type { RecordNetwork } from "../record-network";
import { issuedAsset, trustlineColumns } from "./assets";
import { epochAt, network } from "./network";

export const stellarRecordNetwork: RecordNetwork = {
  network,
  epochAt,
  assetColumns: trustlineColumns,
  assetFromColumns: ({ code, issuer }) => issuedAsset(code, issuer),
};
