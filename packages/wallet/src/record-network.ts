import type { Asset } from "./contract";
import { stellarRecordNetwork } from "./stellar/record-network";

export interface AssetColumns {
  readonly code: string;
  readonly issuer: string;
}

export interface RecordNetwork {
  readonly network: string;
  readonly epochAt: (time: number) => string;
  readonly assetColumns: (asset: Asset) => AssetColumns;
  readonly assetFromColumns: (columns: AssetColumns) => Asset;
}

const recordNetwork: RecordNetwork = stellarRecordNetwork;

export const { network, epochAt, assetColumns, assetFromColumns } =
  recordNetwork;
