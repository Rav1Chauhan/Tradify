import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";

// ==========================================
// 1. CONFIGURATION
// ==========================================

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing from environment variables");
}

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

const connection = new Connection(RPC_URL, "confirmed");

const bot = new Telegraf(BOT_TOKEN);

const NETWORK = "Devnet";

// ==========================================
// 2. TYPES AND STORAGE
// ==========================================

const USERS: Record<number, Keypair> = {};

type PendingRequest =
  | {
      type: "SEND_SOL";
      step: "RECIPIENT";
    }
  | {
      type: "SEND_SOL";
      step: "AMOUNT";
      to: string;
    }
  | {
      type: "SEND_SOL";
      step: "CONFIRM";
      to: string;
      lamports: number;
    };

const PENDING_REQUEST: Record<number, PendingRequest> = {};

// ==========================================
// 3. WALLET GENERATION
// ==========================================

async function generateWallet(): Promise<Keypair> {
  return Keypair.generate();
}

// ==========================================
// 4. KEYBOARD
// ==========================================

const keyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🔑 Generate Wallet", "generate_wallet")],
  [
    Markup.button.callback("👁️ View Address", "view_address"),
    Markup.button.callback("🔐 Export Private Key", "export_private_key"),
  ],
  [
    Markup.button.callback("💰 Check Balance", "check_balance"),
    Markup.button.callback("📊 Transaction History", "tx_history"),
  ],
  [
    Markup.button.callback("💸 Send SOL", "send_sol"),
    Markup.button.callback("🪙 Send Token", "send_token_menu"),
  ],
]);

// ==========================================
// 5. HELPER FUNCTIONS
// ==========================================

// Convert SOL to lamports without floating-point errors.

function parseSolToLamports(value: string): number | null {
  if (!/^\d+(\.\d{1,9})?$/.test(value)) {
    return null;
  }

  const parts = value.split(".");

  const whole = parts[0];
  const fraction = parts[1] ?? "";

  if (whole === undefined) {
    return null;
  }

  const lamports =
    BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));

  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return Number(lamports);
}

// Calculate the actual transaction fee using the RPC.

async function getTransferFee(
  sender: PublicKey,
  recipient: PublicKey,
  lamports: number,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: sender,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: recipient,
      lamports,
    }),
  );

  const message = transaction.compileMessage();

  const fee = await connection.getFeeForMessage(message);

  if (fee.value === null) {
    throw new Error("Unable to calculate transaction fee");
  }

  return Number(fee.value);
}

// ==========================================
// 6. START COMMAND
// ==========================================

bot.start(async (ctx) => {
  const welcomeMessage = `
🤖 *Welcome to Solana Wallet Bot!*

Your secure, easy-to-use Solana wallet manager.

━━━━━━━━━━━━━━━━━━

✨ *FEATURES*

• 🔑 Generate new wallets
• 📋 Import existing wallets
• 💰 Check SOL balances
• 💸 Send SOL and SPL tokens
• 📊 View transaction history
• 🔒 Secure wallet management

━━━━━━━━━━━━━━━━━━

🛡 *SECURITY*

• Private keys must be encrypted before storage.
• Never share your seed phrase.
• Always verify recipient addresses.
• Start with Devnet for testing.

━━━━━━━━━━━━━━━━━━

🚀 Choose an option below to get started:

🌐 Network: *${NETWORK}*
`;

  return ctx.reply(welcomeMessage, {
    parse_mode: "Markdown",
    ...keyboard,
  });
});

// ==========================================
// 7. GENERATE WALLET
// ==========================================

bot.action("generate_wallet", async (ctx) => {
  await ctx.answerCbQuery("Generating wallet...");

  const userId = ctx.from.id;

  if (USERS[userId]) {
    return ctx.reply(
      "⚠️ You already have a wallet. Use View Address to see it.",
      keyboard,
    );
  }

  try {
    const keypair = await generateWallet();

    USERS[userId] = keypair;

    const publicKey = keypair.publicKey.toBase58();

    return ctx.reply(
      `🔑 *New Solana Wallet Created!*\n\n` +
        `📍 *Public Address:*\n\`${publicKey}\`\n\n` +
        `🌐 Network: *${NETWORK}*\n\n` +
        `🛡 Keep your private key secure.`,
      {
        parse_mode: "Markdown",
        ...keyboard,
      },
    );
  } catch (error) {
    console.error("Wallet generation error:", error);

    return ctx.reply("❌ Unable to generate wallet.");
  }
});

// ==========================================
// 8. VIEW ADDRESS
// ==========================================

bot.action("view_address", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply(
      "❌ You don't have a wallet yet. Generate one first.",
      keyboard,
    );
  }

  const publicKey = keypair.publicKey.toBase58();

  return ctx.reply(
    `👛 *Your Solana Wallet*\n\n` +
      `📍 *Public Address:*\n\`${publicKey}\`\n\n` +
      `🌐 Network: *${NETWORK}*`,
    {
      parse_mode: "Markdown",
      ...keyboard,
    },
  );
});

// ==========================================
// 9. CHECK BALANCE
// ==========================================

bot.action("check_balance", async (ctx) => {
  await ctx.answerCbQuery("Fetching balance...");

  const userId = ctx.from.id;
  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply("❌ Generate a wallet first.", keyboard);
  }

  try {
    const balance = await connection.getBalance(keypair.publicKey);

    const sol = Number(balance) / LAMPORTS_PER_SOL;

    return ctx.reply(
      `💰 *Wallet Balance*\n\n` +
        `📍 Address:\n\`${keypair.publicKey.toBase58()}\`\n\n` +
        `◎ Balance: *${sol} SOL*\n` +
        `🌐 Network: *${NETWORK}*`,
      {
        parse_mode: "Markdown",
        ...keyboard,
      },
    );
  } catch (error) {
    console.error("Balance error:", error);

    return ctx.reply("❌ Unable to fetch balance.");
  }
});

// ==========================================
// 10. TRANSACTION HISTORY
// ==========================================

bot.action("tx_history", async (ctx) => {
  await ctx.answerCbQuery("Fetching transaction history...");

  const userId = ctx.from.id;
  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply("❌ Generate a wallet first.", keyboard);
  }

  try {
    const signatures = await connection.getSignaturesForAddress(
      keypair.publicKey,
      { limit: 10 },
    );

    if (signatures.length === 0) {
      return ctx.reply("📊 No transactions found for your wallet.", keyboard);
    }

    const history = signatures
      .map((tx, index) => {
        const status = tx.err ? "❌ Failed" : "✅ Successful";

        return (
          `*${index + 1}. ${status}*\n` +
          `Signature: \`${tx.signature}\`\n` +
          `Slot: ${tx.slot}`
        );
      })
      .join("\n\n");

    return ctx.reply(`📊 *Transaction History*\n\n${history}`, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  } catch (error) {
    console.error("History error:", error);

    return ctx.reply("❌ Unable to fetch transaction history.");
  }
});

// ==========================================
// 11. EXPORT PRIVATE KEY
// ==========================================

bot.action("export_private_key", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply("❌ No wallet found.", keyboard);
  }

  return ctx.reply(
    `🔐 *Wallet Backup*\n\n` +
      `Your private key controls your funds.\n\n` +
      `Direct private-key export through Telegram is disabled for security.\n\n` +
      `A secure encrypted backup system will be implemented separately.`,
    {
      parse_mode: "Markdown",
      ...keyboard,
    },
  );
});

// ==========================================
// 12. SEND SOL - START
// ==========================================

bot.action("send_sol", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply("❌ Generate a wallet first.", keyboard);
  }

  PENDING_REQUEST[userId] = {
    type: "SEND_SOL",
    step: "RECIPIENT",
  };

  return ctx.reply(
    `💸 *Send SOL*\n\n` +
      `Your wallet:\n\`${keypair.publicKey.toBase58()}\`\n\n` +
      `Please enter the recipient's Solana wallet address.\n\n` +
      `⚠️ Verify the recipient address carefully.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "cancel_send_sol")],
      ]),
    },
  );
});

// ==========================================
// 13. SEND SOL - MESSAGE HANDLER
// ==========================================

bot.on(message("text"), async (ctx) => {
  const userId = ctx.from.id;

  const request = PENDING_REQUEST[userId];

  if (!request || request.type !== "SEND_SOL") {
    return;
  }

  const text = ctx.message.text.trim();

  // STEP 1: RECEIVE RECIPIENT ADDRESS

  if (request.step === "RECIPIENT") {
    try {
      const recipient = new PublicKey(text);

      PENDING_REQUEST[userId] = {
        type: "SEND_SOL",
        step: "AMOUNT",
        to: recipient.toBase58(),
      };

      return ctx.reply(
        `✅ *Recipient Address Verified*\n\n` +
          `\`${recipient.toBase58()}\`\n\n` +
          `💰 How much SOL do you want to send?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", "cancel_send_sol")],
          ]),
        },
      );
    } catch {
      return ctx.reply(
        "❌ Invalid Solana public key.\n\nPlease enter a valid address.",
      );
    }
  }

  // STEP 2: RECEIVE AMOUNT

  if (request.step === "AMOUNT") {
    const lamports = parseSolToLamports(text);

    if (lamports === null) {
      return ctx.reply(
        "❌ Invalid amount.\n\nEnter a positive SOL amount with up to 9 decimal places.",
      );
    }

    const keypair = USERS[userId];

    if (!keypair) {
      delete PENDING_REQUEST[userId];

      return ctx.reply("❌ Wallet not found.");
    }

    try {
      const recipient = new PublicKey(request.to);

      if (recipient.equals(keypair.publicKey)) {
        return ctx.reply(
          "❌ You cannot send SOL to your own wallet. Enter another address.",
        );
      }

      const balance = Number(await connection.getBalance(keypair.publicKey));

      const fee = await getTransferFee(keypair.publicKey, recipient, lamports);

      if (balance < lamports + fee) {
        return ctx.reply(
          `❌ *Insufficient Balance*\n\n` +
            `Available: ${balance / LAMPORTS_PER_SOL} SOL\n` +
            `Requested: ${lamports / LAMPORTS_PER_SOL} SOL\n` +
            `Estimated fee: ${fee / LAMPORTS_PER_SOL} SOL`,
          { parse_mode: "Markdown" },
        );
      }

      PENDING_REQUEST[userId] = {
        type: "SEND_SOL",
        step: "CONFIRM",
        to: request.to,
        lamports,
      };

      return ctx.reply(
        `🔍 *Transaction Preview*\n\n` +
          `📤 *From:*\n\`${keypair.publicKey.toBase58()}\`\n\n` +
          `📥 *To:*\n\`${request.to}\`\n\n` +
          `💰 Amount: *${lamports / LAMPORTS_PER_SOL} SOL*\n` +
          `⛽ Estimated Fee: *${fee / LAMPORTS_PER_SOL} SOL*\n\n` +
          `🌐 Network: *${NETWORK}*\n\n` +
          `Do you want to proceed?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "✅ Confirm Transaction",
                "confirm_send_sol",
              ),
            ],
            [Markup.button.callback("❌ Cancel", "cancel_send_sol")],
          ]),
        },
      );
    } catch (error) {
      console.error("Transaction preparation error:", error);

      return ctx.reply("❌ Unable to prepare transaction. Please try again.");
    }
  }

  // Ignore text while waiting for confirmation.
  if (request.step === "CONFIRM") {
    return ctx.reply("Please use the Confirm or Cancel buttons.");
  }
});

// ==========================================
// 14. SEND SOL - CONFIRM TRANSACTION
// ==========================================

bot.action("confirm_send_sol", async (ctx) => {
  await ctx.answerCbQuery("Processing transaction...");

  const userId = ctx.from.id;

  const request = PENDING_REQUEST[userId];

  if (!request || request.type !== "SEND_SOL" || request.step !== "CONFIRM") {
    return ctx.reply("❌ No pending transaction found.");
  }

  const keypair = USERS[userId];

  if (!keypair) {
    delete PENDING_REQUEST[userId];

    return ctx.reply("❌ Wallet not found.");
  }

  try {
    const recipient = new PublicKey(request.to);

    const balance = Number(await connection.getBalance(keypair.publicKey));

    const fee = await getTransferFee(
      keypair.publicKey,
      recipient,
      request.lamports,
    );

    if (balance < request.lamports + fee) {
      delete PENDING_REQUEST[userId];

      return ctx.reply("❌ Insufficient balance for this transaction.");
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports: request.lamports,
      }),
    );

    // Delete pending request before submission to prevent
    // repeated confirmation clicks from sending twice.
    delete PENDING_REQUEST[userId];

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      { commitment: "confirmed" },
    );

    return ctx.reply(
      `✅ *Transaction Successful!*\n\n` +
        `💰 Amount: *${request.lamports / LAMPORTS_PER_SOL} SOL*\n\n` +
        `📥 Recipient:\n\`${request.to}\`\n\n` +
        `🔗 Transaction:\n\`${signature}\`\n\n` +
        `[View on Solscan](https://solscan.io/tx/${signature}?cluster=devnet)`,
      {
        parse_mode: "Markdown",
        ...keyboard,
      },
    );
  } catch (error) {
    console.error("Transaction error:", error);

    return ctx.reply(
      "❌ Transaction submission failed or its status is uncertain. Check transaction history before retrying.",
    );
  }
});

// ==========================================
// 15. CANCEL SEND SOL
// ==========================================

bot.action("cancel_send_sol", async (ctx) => {
  await ctx.answerCbQuery("Transaction cancelled.");

  const userId = ctx.from.id;

  delete PENDING_REQUEST[userId];

  return ctx.reply("❌ Send SOL request cancelled.", keyboard);
});

// ==========================================
// 16. SEND SPL TOKEN MENU
// ==========================================

bot.action("send_token_menu", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const keypair = USERS[userId];

  if (!keypair) {
    return ctx.reply("❌ Generate a wallet first.", keyboard);
  }

  return ctx.reply(
    `🪙 *Send SPL Token*\n\n` +
      `Your wallet:\n\`${keypair.publicKey.toBase58()}\`\n\n` +
      `SPL token transfers will require:\n\n` +
      `1. Token mint address\n` +
      `2. Recipient address\n` +
      `3. Token amount\n\n` +
      `This feature is not implemented yet.`,
    {
      parse_mode: "Markdown",
      ...keyboard,
    },
  );
});

// ==========================================
// 17. BOT ERROR HANDLING
// ==========================================

bot.catch((error, ctx) => {
  console.error(`Bot error for update ${ctx.update.update_id}:`, error);
});

// ==========================================
// 18. START BOT
// ==========================================

async function startBot(): Promise<void> {
  try {
    await bot.launch({
      allowedUpdates: ["message", "callback_query"],
    });

    console.log("🤖 Solana Wallet Bot started successfully!");
    console.log(`🌐 Network: ${NETWORK}`);
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

startBot();

// Graceful shutdown

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
