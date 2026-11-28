import type { DeviceNetwork } from "../device-network";
import type { RecordNetwork } from "../record-network";
import { solanaDeviceNetwork } from "../solana/device-network";
import { chainId } from "../solana/network";
import { solanaRecordNetwork } from "../solana/record-network";

export const deviceNetwork: DeviceNetwork = solanaDeviceNetwork;

export const recordNetwork: RecordNetwork = solanaRecordNetwork;

export const blockchainId = chainId;
