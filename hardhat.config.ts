import { existsSync } from "fs";
import hardhatEthersPlugin from "@nomicfoundation/hardhat-ethers";
import hardhatChaiMatchersPlugin from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMochaPlugin from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpersPlugin from "@nomicfoundation/hardhat-network-helpers";
import { defineConfig } from "hardhat/config";

if (existsSync(".env")) process.loadEnvFile(".env");

const { INFURA_KEY, PK, MNEMONIC, ALCHEMY_KEY } = process.env;

const accounts = PK
  ? [PK]
  : {
      mnemonic:
        MNEMONIC ??
        "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
    };

export default defineConfig({
  plugins: [
    hardhatEthersPlugin,
    hardhatChaiMatchersPlugin,
    hardhatMochaPlugin,
    hardhatNetworkHelpersPlugin,
  ],
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    sources: "contracts",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.38",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 100 },
        },
      },
    },
  },
  networks: {
    mainnet: {
      type: "http",
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
      accounts,
    },
    gnosis: {
      type: "http",
      url: "https://rpc.gnosischain.com",
      accounts,
    },
    sepolia: {
      type: "http",
      url: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
      accounts,
    },
    arbitrum: {
      type: "http",
      url: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts,
    },
    optimism: {
      type: "http",
      url: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts,
    },
    polygon: {
      type: "http",
      url: "https://rpc.ankr.com/polygon",
      accounts,
    },
    avalanche: {
      type: "http",
      url: `https://avalanche-mainnet.infura.io/v3/${INFURA_KEY}`,
      accounts,
    },
    bsc: {
      type: "http",
      url: "https://bsc-dataseed.binance.org",
      accounts,
    },
    base: {
      type: "http",
      url: "https://mainnet.base.org",
      accounts,
    },
    core: {
      type: "http",
      url: "https://rpc.coredao.org",
      accounts,
    },
    coreTestnet: {
      type: "http",
      url: "https://rpc.test.btcs.network",
      accounts,
    },
  },

  test: {
    mocha: {
      timeout: 2_000_000,
    },
  },
});
