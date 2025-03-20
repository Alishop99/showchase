import { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@project-serum/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { IDL } from './candy_machine'; // IDL dari Metaplex Candy Machine v3

const CANDY_MACHINE_ID = new PublicKey(process.env.REACT_APP_CANDY_MACHINE_ID);
const CANDY_GUARD_ID = new PublicKey('J5FjmYgaPvZrYPgQBJ581JTD1qgCikEhiaaZEu9ZXf6e');
const RPC = process.env.REACT_APP_SOLANA_RPC_HOST;

function App() {
  const wallet = useWallet();
  const [candyMachine, setCandyMachine] = useState(null);
  const [guards, setGuards] = useState(null);

  useEffect(() => {
    if (!wallet.connected) return;

    const connection = new Connection(RPC, 'confirmed');
    const provider = new AnchorProvider(connection, wallet, {});
    const program = new Program(IDL, CANDY_MACHINE_ID, provider);

    async function fetchCandyMachine() {
      const cm = await program.account.candyMachine.fetch(CANDY_MACHINE_ID);
      setCandyMachine(cm);

      // Fetch guards
      const guardAccount = await connection.getAccountInfo(CANDY_GUARD_ID);
      if (guardAccount) {
        const guardData = program.coder.accounts.decode('CandyGuard', guardAccount.data);
        setGuards(guardData);
      }
    }
    fetchCandyMachine();
  }, [wallet.connected]);

  const mintNFT = async () => {
    if (!wallet.connected) {
      alert('Connect your wallet!');
      return;
    }

    // Logika minting di sini
    // Pastikan wallet memiliki token untuk tokenGate dan tokenPayment
    console.log('Minting...');
  };

  return (
    <div>
      <h1>Bubu NFT Mint</h1>
      {!wallet.connected ? (
        <button onClick={wallet.connect}>Connect Wallet</button>
      ) : (
        <>
          <p>Candy Machine ID: {CANDY_MACHINE_ID.toBase58()}</p>
          <p>Items Available: {candyMachine?.data.itemsAvailable.toString()}</p>
          {guards && (
            <div>
              <p>Guards:</p>
              <p>Bot Tax: {guards.default.botTax.value.toString()} SOL</p>
              <p>Token Gate: 5 tokens ({guards.groups[0].guards.tokenGate.mint.toBase58()})</p>
              <p>Token Payment: 100 tokens to {guards.groups[0].guards.tokenPayment.destination.toBase58()}</p>
            </div>
          )}
          <button onClick={mintNFT}>Mint NFT</button>
        </>
      )}
    </div>
  );
}

export default App;