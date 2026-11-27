# Orchid

Orchid's wallet domain covers sponsored Stellar accounts and payments between usernames or external addresses.

## Language

**Wallet**: The user's Orchid payment identity, associated with a Stellar account and a permanent username.
_Avoid_: Account when referring to the complete Orchid identity.

**Secret phrase**: The words on the user's device from which the wallet's signing key derives; whoever holds them controls the wallet.
_Avoid_: Recovery phrase, seed, private key when referring to the words.

**Backup**: The passkey-encrypted copy of a wallet's secret phrase that Orchid holds; only the passkey that encrypted it can unlock it.
_Avoid_: Recovery, seed backup.

**Restore**: Recovering a wallet on a device from its backup, after the device proves it holds the passkey.
_Avoid_: Recovery, import.

**Account address**: The public identifier of an account on the wallet's network, which decides what a valid one looks like.
_Avoid_: Username, private key.

**Username**: A permanent name bound to one account address when the wallet is created. It resolves as a recipient only while the wallet is active, and stays bound if the wallet's account leaves the network.
_Avoid_: Temporary alias, recyclable handle.

**Unopened wallet**: A wallet whose username is bound and whose backup is stored, but whose sponsored account does not exist on the network yet. Only its holder sees it: its username resolves to nobody, so nothing can be paid to it. Creating a wallet signs its opening, so a new wallet stays unopened only until that opening settles, or if it fails.
_Avoid_: Inactive wallet, pending wallet.

**Opening**: Establishing or repairing the sponsored account and base trustline so an unopened wallet, or one whose account left the network, can become active. Orchid never closes an open wallet to take its reserves back.

**Reserve sponsor**: The account providing the Stellar reserves needed for sponsored accounts and trustlines.
_Avoid_: Fee payer when referring to reserves.

**Fee payer**: The account paying transaction fees; this role is distinct from reserve sponsorship.

**Channel**: An Orchid account that holds no funds and serves as the transaction source of an opening or a link receive, so drafts made at the same time never compete for one sequence number. Each draft leases its own channel until the draft settles or expires.
_Avoid_: Fee payer or reserve sponsor when referring to the transaction source.

**Asset**: Something a wallet can hold and send, such as XLM or USDC. An identifier, which only the network can interpret, tells it apart from every other asset; its display code is what people read, and different assets can share one. Each asset has a precision: how many decimal places its amounts carry and the largest amount it allows.
_Avoid_: Symbol or display code alone when identifying an asset.

**Trustline**: An account's relationship with an issued asset that allows it to hold that asset.

**Transfer order**: A uniquely identified instruction to send an asset amount to a recipient, with an optional external payment memo.
_Avoid_: Transaction when referring to the user's instruction rather than its network execution.

**Transfer intent**: What the user entered to send (recipient, asset, amount and optional payment memo) before the device turns it into a transfer order.
_Avoid_: Order when referring to the entry before it has an id.

**Unclaimed funds**: An asset amount that has left its sender and that the network holds until someone claims it, because no wallet can receive it yet: a **Payment link** holds one, and so does a payment to a wallet that cannot hold the **Asset** yet. The sender takes it back by claiming it. An identifier, which only the network can interpret, tells it apart from all other unclaimed funds.
_Avoid_: Claimable balance; escrow, because nobody has custody of the funds; balance, which is what a wallet holds.

**Payment link**: A URL that carries the **Link code** for **Unclaimed funds**, so whoever opens it can receive them or send them to another address.

**Link code**: The short checksummed code after the `#` in a payment link. The device derives the **Link key** from it; the server never receives it.
_Avoid_: Link secret.

**Link key**: The key that controls a payment link's own account, which can claim the link's **Unclaimed funds**. Only the network can interpret it, and it never leaves the device.
_Avoid_: Link secret.

**Payment request**: A public ask to be paid an asset amount, with an optional note, that its requester shares as a link. It names the requester by username, carries no secret and puts nothing on the network. It is **open** while it waits to be paid, **paid** once it has been, or **cancelled** once its requester withdraws it while open. It is paid only by the Orchid payment bound to it, once that payment settles. The binding is made before the payment can be approved and lasts until the payment settles or can no longer be approved or settle, so a request cannot be cancelled while bound and a cancelled request stays cancelled; money sent any other way is an ordinary payment the request does not know about. It can be paid only directly into the requester's wallet, never as **Unclaimed funds**.
_Avoid_: **Payment link**, which carries a **Link code** for **Unclaimed funds**; invoice; charge.

**Payout**: Receiving a **Payment link** in local currency at a **Payout destination**: the link's **Unclaimed funds** are claimed on the network to the **Payout partner**'s deposit address, and the partner pays the quoted local amount. A payout is **sending** until that claim settles, **processing** while the partner pays, **completed** once the partner has paid, and **failed** if the claim does not settle.
_Avoid_: Withdrawal, cash-out, off-ramp.

**Payout partner**: The company that receives a payout's funds on the network and pays its local amount. Until Orchid has a licensed partner, a **simulated partner** stands in on testnet: an Orchid-controlled address receives the funds and nobody is paid.

**Payout destination**: Where the partner pays a payout, such as a Yape account identified by a Peruvian mobile number. It never goes on the network and is never shown to the link's sender.

**Payout quote**: The local-currency amount, such as S/ 187.40, that the partner pays for a link's asset amount.

**Asset order**: A uniquely identified instruction to open or close a trustline, or claim **Unclaimed funds**.

**Draft**: An unsigned transaction offered for approval before its expiry.
_Avoid_: Completed transfer.

**Approval**: The user's signature authorizing the requested transaction.
_Avoid_: Settlement.

**Settlement**: A transaction's successful outcome established by ledger evidence.
_Avoid_: Submission acknowledgement.

**Payment memo**: A text or numeric reference accompanying a payment to an external address, such as an exchange deposit reference.

**Wallet session**: Orchid's proof, given after the wallet's passkey is verified, that requests come from the wallet's holder. It lets the device read the wallet and request **Drafts**; it never authorizes an **Approval**.
_Avoid_: Login when talking to users.

**Embedded browser**: The in-app browser of an app such as Instagram, Facebook, TikTok or WhatsApp. It cannot evaluate a passkey's PRF, so Orchid hands the user off to their own browser before any passkey ceremony.
_Avoid_: Webview when talking to users.

**Deposit**: USDC that reached a wallet from outside Orchid, such as an exchange or another wallet app, read from the network's asset events and listed in activity.
_Avoid_: Payment or transfer when the money did not go through Orchid.

**Sweep**: Hourly backstop that reconciles pending operations the queue left unfinished, cleans up received links, and prunes expired drafts and abandoned openings.

## Names in the app

Product names in English:

| Spanish         | English         |
| --------------- | --------------- |
| Ahorro          | Savings         |
| Mis links       | My links        |
| Link de pago    | Payment link    |
| Link de cobro   | Payment request |
| Pendiente       | Open            |
| Pagado          | Paid            |
| Cancelado       | Cancelled       |
| Inicio          | Home            |
| Actividad       | Activity        |
| Enviar          | Send            |
| Recibir         | Receive         |
| Ajustes         | Settings        |
| Recibir en Yape | Receive in Yape |
| Enviando        | Sending         |
| En proceso      | Processing      |
| Completado      | Completed       |
| Fallido         | Failed          |
| Simulación      | Simulation      |
