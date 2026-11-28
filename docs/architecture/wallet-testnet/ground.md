# Ground: platform constraints the wallet depends on

Each constraint below is relied on by `packages/wallet` or `apps/web`. Each one links to the official page that states it.

## Cloudflare

- **Query caching.** Hyperdrive caches read queries by default, with a default `max_age` of 60 seconds. It can be disabled per configuration with `--caching-disabled`, which the wallet requires because its reads are plain `SELECT`s. [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
- **Transaction-mode pooling.** Hyperdrive pools in transaction mode and resets a connection when it returns to the pool. Session-level advisory locks are not supported, so the wallet uses transaction-level locks. [Connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).
- **Cron Triggers.** A cron expression maps to a Worker's `scheduled()` handler. A Cron Trigger invocation gets up to 15 minutes of wall-clock time, and up to 15 minutes of CPU time for intervals of one hour or more. The sweep and the deposit ingest run hourly. [Limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- **Queues.** A message can be sent with a `delaySeconds` of up to 86400, and the consumer's `queue()` handler can `ack()` or `retry({ delaySeconds })` each message. `Message.attempts` starts at 1. A consumer's `max_retries` defaults to 3, and a message past it is deleted. If the handler throws, the batch is retried except for messages already acknowledged. [JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [Batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/).
