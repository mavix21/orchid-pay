export const network = "devnet";

const genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const chainId = `solana:${genesisHash.slice(0, 32)}`;

export const epochAt = () => genesisHash;
