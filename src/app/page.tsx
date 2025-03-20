'use client';

import Image from 'next/image';
import styles from './page.module.css';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { LedgerWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey as Web3PublicKey } from '@solana/web3.js';
import {
  base58PublicKey,
  generateSigner,
  Option,
  PublicKey,
  publicKey,
  SolAmount,
  some,
  transactionBuilder,
  Umi,
  unwrapSome,
} from '@metaplex-foundation/umi';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-essentials';
import { mplTokenMetadata, TokenStandard, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV2,
  safeFetchCandyGuard,
  DefaultGuardSetMintArgs,
  DefaultGuardSet,
  SolPayment,
  CandyMachine,
  CandyGuard,
} from '@metaplex-foundation/mpl-candy-machine';

type NFTMetadata = {
  name: string;
  image: string;
};

export default function Home() {
  const network = process.env.NEXT_PUBLIC_NETWORK === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : process.env.NEXT_PUBLIC_NETWORK === 'testnet'
    ? WalletAdapterNetwork.Testnet
    : WalletAdapterNetwork.Mainnet;

  const endpoint = `https://${process.env.NEXT_PUBLIC_RPC_URL}`;
  const wallets = useMemo(() => [new LedgerWalletAdapter(), new SolflareWalletAdapter({ network })], [network]);

  const WalletMultiButtonDynamic = dynamic(
    async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
    { ssr: false }
  );

  let umi: Umi = createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine());

  const [nfts, setNfts] = useState<NFTMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mintMsg, setMintMsg] = useState<string>();
  const [mintCreated, setMintCreated] = useState<PublicKey | null>(null);
  const [countTotal, setCountTotal] = useState<number>(0);
  const [countRemaining, setCountRemaining] = useState<number>(0);
  const [countMinted, setCountMinted] = useState<number>(0);
  const [mintDisabled, setMintDisabled] = useState<boolean>(true);
  const [costInSol, setCostInSol] = useState<number>(0);
  const [tokenCost, setTokenCost] = useState<{ gate: number; payment: number }>({ gate: 0, payment: 0 });
  const [cmv3v2, setCandyMachine] = useState<CandyMachine | null>(null);
  const [defaultCandyGuardSet, setDefaultCandyGuardSet] = useState<CandyGuard<DefaultGuardSet> | null>(null);

  const fetchAllNFTsAndStats = useCallback(async () => {
    const cmId = process.env.NEXT_PUBLIC_CANDY_MACHINE_ID;
    if (!cmId) {
      setError('No candy machine ID found. Add environment variable.');
      setLoading(false);
      return;
    }

    try {
      console.log('Fetching Candy Machine with RPC:', endpoint);
      const candyMachine: CandyMachine = await fetchCandyMachine(umi, publicKey(cmId));
      console.log('Candy Machine Data:', candyMachine);
      setCandyMachine(candyMachine);

      setCountTotal(candyMachine.itemsLoaded);
      setCountMinted(Number(candyMachine.itemsRedeemed));
      const remaining = candyMachine.itemsLoaded - Number(candyMachine.itemsRedeemed);
      setCountRemaining(remaining);

      const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
      console.log('Candy Guard Data:', candyGuard);
      if (candyGuard) {
        setDefaultCandyGuardSet(candyGuard);
        const defaultGuards: DefaultGuardSet | undefined = candyGuard.guards;
        const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

        if (solPaymentGuard) {
          const solPayment: SolPayment | null = unwrapSome(solPaymentGuard);
          if (solPayment) {
            const lamports: SolAmount = solPayment.lamports;
            const solCost = Number(lamports.basisPoints) / 1000000000;
            setCostInSol(solCost);
          }
        }

        const group = candyGuard.groups.find((g) => g.label === 'GABU');
        if (group) {
          console.log('GABU Guards:', group.guards);
          const tokenGateGuard: Option<any> | undefined = group.guards.tokenGate;
          const tokenPaymentGuard: Option<any> | undefined = group.guards.tokenPayment;

          if (tokenGateGuard) {
            const tokenGate = unwrapSome(tokenGateGuard);
            if (tokenGate && tokenGate.amount) {
              setTokenCost((prev) => ({ ...prev, gate: Number(tokenGate.amount) }));
            }
          }
          if (tokenPaymentGuard) {
            const tokenPayment = unwrapSome(tokenPaymentGuard);
            if (tokenPayment && tokenPayment.amount) {
              setTokenCost((prev) => ({ ...prev, payment: Number(tokenPayment.amount) }));
            }
          }
        }
      }

      const nftPromises = [];
      const seenUris = new Set<string>();
      for (let i = 0; i < candyMachine.itemsLoaded; i++) {
        const item = candyMachine.items[i];
        if (item && item.uri && !seenUris.has(item.uri)) {
          seenUris.add(item.uri);
          console.log('Fetching URI:', item.uri);
          nftPromises.push(fetch(item.uri).then((res) => res.json()));
        }
      }

      const nftMetadatas = await Promise.all(nftPromises);
      console.log('NFT Metadatas:', nftMetadatas);
      const validNfts = nftMetadatas
        .filter((metadata) => metadata && metadata.name && metadata.image)
        .map((metadata) => ({
          name: metadata.name,
          image: metadata.image,
        }));

      setNfts(validNfts);
      if (remaining > 0) {
        setMintDisabled(false);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Failed to fetch NFTs or stats:', err);
      setError(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [endpoint, umi]);

  useEffect(() => {
    fetchAllNFTsAndStats();
  }, [fetchAllNFTsAndStats, mintCreated]);

  const Mint = () => {
    const wallet = useWallet();
    umi = umi.use(walletAdapterIdentity(wallet));

    const checkWalletBalance = useCallback(async () => {
      try {
        const balance: SolAmount = await umi.rpc.getBalance(umi.identity.publicKey);
        console.log('Wallet Balance:', Number(balance.basisPoints) / 1000000000, 'SOL');
        if (Number(balance.basisPoints) / 1000000000 < costInSol) {
          setMintMsg('Add more SOL to your wallet.');
          setMintDisabled(true);
        } else if (countRemaining !== undefined && countRemaining > 0) {
          setMintDisabled(false);
        }
      } catch (error) {
        setMintMsg('Error checking wallet balance.');
        console.error('Balance Check Error:', error);
      }
    }, [costInSol, countRemaining, umi]);

    useEffect(() => {
      if (wallet.connected) {
        checkWalletBalance();
      }
    }, [checkWalletBalance, wallet.connected]);

    if (!wallet.connected) {
      return <p>Please connect your wallet.</p>;
    }

    const mintBtnHandler = async () => {
      if (!cmv3v2 || !defaultCandyGuardSet) {
        setMintMsg('Error fetching Candy Machine. Refresh the page.');
        return;
      }
      setLoading(true);
      setMintMsg(undefined);

      try {
        const candyMachine = cmv3v2;
        const candyGuard = defaultCandyGuardSet;
        const nftSigner = generateSigner(umi);
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};

        const group = candyGuard.groups.find((g) => g.label === 'GABU');
        if (!group) {
          throw new Error('GABU group not found in guards');
        }
        console.log('GABU Guards:', group.guards);

        const tokenGateGuard = unwrapSome(group.guards.tokenGate);
        const tokenPaymentGuard = unwrapSome(group.guards.tokenPayment);

        if (tokenGateGuard) {
          mintArgs.tokenGate = some({ mint: tokenGateGuard.mint, amount: tokenGateGuard.amount });
          console.log('Token Gate Mint:', tokenGateGuard.mint, 'Amount:', tokenGateGuard.amount);
        }
        if (tokenPaymentGuard) {
          // Convert Umi PublicKey to Web3 PublicKey
          const mintWeb3 = new Web3PublicKey(tokenPaymentGuard.mint.toString());
          const destinationAta = getAssociatedTokenAddressSync(
            mintWeb3,
            new Web3PublicKey(tokenPaymentGuard.destinationAta.toString()),
            false
          );

          // Convert back to Umi PublicKey
          const destinationAtaUmi = publicKey(destinationAta.toBase58());

          mintArgs.tokenPayment = some({
            mint: tokenPaymentGuard.mint,
            amount: tokenPaymentGuard.amount,
            destinationAta: destinationAtaUmi,
          });
          console.log('Token Payment Mint:', tokenPaymentGuard.mint, 'Amount:', tokenPaymentGuard.amount, 'Destination ATA:', destinationAtaUmi);
        }

        console.log('Mint Args:', mintArgs);
        console.log('NFT Mint Address:', nftSigner.publicKey);
        console.log('Wallet Public Key:', umi.identity.publicKey);

        const tx = transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 1_400_000 }))
          .add(
            mintV2(umi, {
              candyMachine: candyMachine.publicKey,
              collectionMint: candyMachine.collectionMint,
              collectionUpdateAuthority: candyMachine.authority,
              nftMint: nftSigner,
              candyGuard: candyGuard?.publicKey,
              mintArgs: mintArgs,
              group: some('GABU'),
              tokenStandard: TokenStandard.ProgrammableNonFungible,
            })
          );

        console.log('Transaction built:', tx);
        console.log('Sending transaction...');
        const result = await tx.sendAndConfirm(umi, {
          confirm: { commitment: 'finalized' },
          send: { skipPreflight: true },
        });
        console.log('SendAndConfirm Result:', result);

        const signature = result.signature;
        if (!signature) {
          throw new Error('No signature returned from transaction');
        }

        console.log('Mint Signature:', base58PublicKey(signature));
        const asset = await fetchDigitalAsset(umi, nftSigner.publicKey);
        const metadataUri = asset.metadata.uri;
        const response = await fetch(metadataUri);
        const metadata = await response.json();
        console.log('Minted NFT Metadata:', metadata);
        setMintCreated(nftSigner.publicKey);
        setMintMsg('Mint was successful!');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        console.error('Mint Error:', err);
        setMintMsg(`Mint failed: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    };

    return (
      <>
        <button
          onClick={mintBtnHandler}
          className={styles.mintBtn}
          disabled={mintDisabled || loading}
        >
          MINT
          <br />
          ({costInSol} SOL + {tokenCost.gate} Token Gate + {tokenCost.payment} Token Payment)
        </button>
        {loading && <div className={styles.loadingDots}>. . .</div>}
        {mintMsg && (
          <div className={styles.mintMsg}>
            <button
              className={styles.mintMsgClose}
              onClick={() => setMintMsg(undefined)}
            >
              ×
            </button>
            <span>{mintMsg}</span>
          </div>
        )}
      </>
    );
  };

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main className={styles.main}>
          <WalletMultiButtonDynamic />

          <h1>All NFTs in Candy Machine</h1>

          <div className={styles.countsContainer}>
            <div>Minted: {countMinted} / {countTotal}</div>
            <div>Remaining: {countRemaining}</div>
          </div>

          <Mint />

          {loading ? (
            <p>Loading NFTs...</p>
          ) : error ? (
            <p>{error}</p>
          ) : nfts.length === 0 ? (
            <p>No NFTs found in Candy Machine.</p>
          ) : (
            <div className={styles.nftGrid}>
              {nfts.map((nft, index) => (
                <div key={index} className={styles.nftCard}>
                  <Image
                    src={nft.image}
                    alt={nft.name}
                    width={200}
                    height={200}
                    priority
                    className={styles.nftImage}
                  />
                  <p>{nft.name}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}