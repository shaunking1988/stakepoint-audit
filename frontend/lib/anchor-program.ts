import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import idlJson from "./staking_program.json";
import type { StakingProgram } from "./staking_program_type";

// ✅ CRITICAL FIX: Define Program ID as PublicKey directly
export const PROGRAM_ID = new PublicKey("gLHaGJsZ6G7AXZxoDL9EsSWkRbKAWhFHi73gVfNXuzK");
console.log("Program ID:", PROGRAM_ID.toString());

// Network RPC endpoint
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://api.devnet.solana.com";
export { RPC_ENDPOINT };

/**
 * Get the Anchor program instance
 */
export function getProgram(wallet: AnchorWallet, connection: Connection): Program<StakingProgram> {
  if (!wallet) {
    throw new Error("Wallet is required");
  }
  if (!connection) {
    throw new Error("Connection is required");
  }
  if (!wallet.publicKey) {
    throw new Error("Wallet public key is undefined");
  }

  console.log("Creating Anchor Provider...");
  const provider = new AnchorProvider(
    connection,
    wallet,
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );

  console.log("Creating Program with:");
  console.log("- Program ID from constant:", PROGRAM_ID.toString());
  console.log("- Wallet:", wallet.publicKey.toString());
  
  // ✅ FIX: Anchor 0.32.1 reads program ID from IDL address field
  const program = new Program<StakingProgram>(
    idlJson as unknown as StakingProgram,
    provider
  );

  console.log("✅ Program instance created successfully");
  return program;
}

/**
 * Get a read-only program instance (no wallet required)
 * Useful for fetching public on-chain data
 */
export function getReadOnlyProgram(connection: Connection): Program<StakingProgram> {
  if (!connection) {
    throw new Error("Connection is required");
  }

  // Create a dummy wallet for read-only operations
  const dummyWallet = {
    publicKey: PROGRAM_ID, // Use program ID as dummy public key
    signTransaction: async () => { throw new Error("Read-only wallet cannot sign"); },
    signAllTransactions: async () => { throw new Error("Read-only wallet cannot sign"); },
  } as AnchorWallet;

  const provider = new AnchorProvider(
    connection,
    dummyWallet,
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );

  const program = new Program<StakingProgram>(
    idlJson as unknown as StakingProgram,
    provider
  );

  return program;
}

/**
 * Helper to convert pool_id number to LE bytes for PDA derivation
 */
function poolIdToBytes(poolId: number): Buffer {
  return Buffer.from(new Uint8Array(new BigUint64Array([BigInt(poolId)]).buffer));
}

/**
 * PDA Seed Constants
 */
const SEEDS = {
  PLATFORM: "platform_v2",
  PROJECT: "project",
  STAKING_VAULT: "staking_vault",
  REWARD_VAULT: "reward_vault",
  REFLECTION_VAULT: "reflection_vault",
  STAKE: "stake",
  // Engine 2 seeds
  PROJECT1: "project1",
  STAKING_VAULT1: "staking_vault1",
  REWARD_VAULT1: "reward_vault1",
  STAKE1: "stake1",
  // Vesting seeds
  VESTING: "vesting",
  VESTING_VAULT: "vesting_vault",
} as const;

/**
 * Get PDA addresses - UPDATED with pool_id support
 */
export const getPDAs = {
  platformConfig: () => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.PLATFORM)],
      PROGRAM_ID
    );
  },

  project: (tokenMint: PublicKey, poolId: number = 0) => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
  },

  stakingVault: (tokenMint: PublicKey, poolId: number = 0) => {
    // Step 1: Get project PDA with pool_id
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
    
    // Step 2: Derive staking vault from project PDA
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.STAKING_VAULT), projectPDA.toBuffer()],
      PROGRAM_ID
    );
  },

  rewardVault: (tokenMint: PublicKey, poolId: number = 0) => {
    // Step 1: Get project PDA with pool_id
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
    
    // Step 2: Derive reward vault from project PDA
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.REWARD_VAULT), projectPDA.toBuffer()],
      PROGRAM_ID
    );
  },

  reflectionVault: (tokenMint: PublicKey, poolId: number = 0, reflectionTokenMint?: PublicKey) => {
    // Step 1: Get project PDA with pool_id
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
    
    // Step 2: Derive reflection vault from project PDA
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.REFLECTION_VAULT), projectPDA.toBuffer()],
      PROGRAM_ID
    );
  },

  userStake: (projectPDA: PublicKey, userWallet: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.STAKE), projectPDA.toBuffer(), userWallet.toBuffer()],
      PROGRAM_ID
    );
  },

  // Engine 2 PDAs
  project1: (tokenMint: PublicKey, poolId: number = 0) => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT1),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
  },

  stakingVault1: (tokenMint: PublicKey, poolId: number = 0) => {
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT1),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.STAKING_VAULT1), projectPDA.toBuffer()],
      PROGRAM_ID
    );
  },

  rewardVault1: (tokenMint: PublicKey, poolId: number = 0) => {
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.PROJECT1),
        tokenMint.toBuffer(),
        poolIdToBytes(poolId),
      ],
      PROGRAM_ID
    );
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.REWARD_VAULT1), projectPDA.toBuffer()],
      PROGRAM_ID
    );
  },

  userStake1: (projectPDA: PublicKey, userWallet: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.STAKE1), projectPDA.toBuffer(), userWallet.toBuffer()],
      PROGRAM_ID
    );
  },

  vestingSchedule: (creator: PublicKey, beneficiary: PublicKey, tokenMint: PublicKey, scheduleId: number = 0) => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.VESTING),
        creator.toBuffer(),
        beneficiary.toBuffer(),
        tokenMint.toBuffer(),
        poolIdToBytes(scheduleId),
      ],
      PROGRAM_ID
    );
  },

  vestingVault: (creator: PublicKey, beneficiary: PublicKey, tokenMint: PublicKey, scheduleId: number = 0) => {
    const [schedulePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SEEDS.VESTING),
        creator.toBuffer(),
        beneficiary.toBuffer(),
        tokenMint.toBuffer(),
        poolIdToBytes(scheduleId),
      ],
      PROGRAM_ID
    );
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.VESTING_VAULT), schedulePDA.toBuffer()],
      PROGRAM_ID
    );
  },
};

/**
 * Create a connection to Solana
 */
export function getConnection(): Connection {
  return new Connection(RPC_ENDPOINT, {
    commitment: "confirmed",
    wsEndpoint: process.env.NEXT_PUBLIC_WS_ENDPOINT || "wss://api.mainnet-beta.solana.com",
  });
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1e9;
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

/**
 * Verify program is deployed
 */
export async function verifyProgramDeployed(connection: Connection): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(PROGRAM_ID);
    return accountInfo !== null && accountInfo.executable;
  } catch (error) {
    console.error("Error verifying program:", error);
    return false;
  }
}// Cache bust Fri Nov 14 03:01:04 GMT 2025
