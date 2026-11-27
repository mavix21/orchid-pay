import type { DeviceNetwork } from "../device-network";
import type { RecordNetwork } from "../record-network";
import { stellarDeviceNetwork } from "../stellar/device-network";
import { stellarRecordNetwork } from "../stellar/record-network";

export const deviceNetwork: DeviceNetwork = stellarDeviceNetwork;

export const recordNetwork: RecordNetwork = stellarRecordNetwork;
