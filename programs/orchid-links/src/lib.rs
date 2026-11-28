use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, CloseAccount, InitializeAccount3, Mint, Token, TokenAccount, Transfer,
};

declare_id!("GAgsxe3vwNSSFcsaMViggfk37wBaj7yioYaXFYa7Cv6M");

pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const RECLAIM_DELAY_SECONDS: i64 = 0;
pub const UNCLAIMED_FUNDS_SEED: &[u8] = b"link";
pub const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod orchid_links {
    use super::*;

    pub fn create(
        ctx: Context<Create>,
        order_id: [u8; 16],
        link: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let _ = order_id;
        require!(amount > 0, OrchidLinksError::ZeroAmount);
        require_keys_neq!(
            link,
            ctx.accounts.sender.key(),
            OrchidLinksError::LinkIsSender
        );

        initialize_vault(ctx.accounts, ctx.bumps.vault)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.sender.to_account_info(),
                },
            ),
            amount,
        )?;

        let reclaimable_at = Clock::get()?
            .unix_timestamp
            .checked_add(RECLAIM_DELAY_SECONDS)
            .ok_or(OrchidLinksError::ClockOverflow)?;

        ctx.accounts.unclaimed_funds.set_inner(UnclaimedFunds {
            sender: ctx.accounts.sender.key(),
            link,
            mint: ctx.accounts.mint.key(),
            rent_recipient: ctx.accounts.rent_recipient.key(),
            amount,
            reclaimable_at,
            bump: ctx.bumps.unclaimed_funds,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        release(
            &ctx.accounts.unclaimed_funds,
            &ctx.accounts.vault,
            ctx.bumps.vault,
            &ctx.accounts.destination,
            &ctx.accounts.rent_recipient,
            &ctx.accounts.token_program,
        )
    }

    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.unclaimed_funds.reclaimable_at,
            OrchidLinksError::NotYetReclaimable
        );
        release(
            &ctx.accounts.unclaimed_funds,
            &ctx.accounts.vault,
            ctx.bumps.vault,
            &ctx.accounts.destination,
            &ctx.accounts.rent_recipient,
            &ctx.accounts.token_program,
        )
    }
}

// The vault owns itself so that it can sign without the order id, which the
// unclaimed funds account does not store.
fn initialize_vault(accounts: &Create, vault_bump: u8) -> Result<()> {
    let unclaimed_funds_key = accounts.unclaimed_funds.key();
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, unclaimed_funds_key.as_ref(), &[vault_bump]];
    let rent = Rent::get()?.minimum_balance(TokenAccount::LEN);
    let current = accounts.vault.lamports();

    if current == 0 {
        anchor_lang::system_program::create_account(
            CpiContext::new(
                accounts.system_program.key(),
                anchor_lang::system_program::CreateAccount {
                    from: accounts.rent_recipient.to_account_info(),
                    to: accounts.vault.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            rent,
            TokenAccount::LEN as u64,
            &token::ID,
        )?;
    } else {
        anchor_lang::system_program::create_account_allow_prefund(
            CpiContext::new(
                accounts.system_program.key(),
                anchor_lang::system_program::CreateAccountAllowPrefund {
                    from: accounts.rent_recipient.to_account_info(),
                    to: accounts.vault.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            rent.saturating_sub(current),
            TokenAccount::LEN as u64,
            &token::ID,
        )?;
    }

    token::initialize_account3(CpiContext::new(
        accounts.token_program.key(),
        InitializeAccount3 {
            account: accounts.vault.to_account_info(),
            mint: accounts.mint.to_account_info(),
            authority: accounts.vault.to_account_info(),
        },
    ))
}

fn release<'info>(
    unclaimed_funds: &Account<'info, UnclaimedFunds>,
    vault: &Account<'info, TokenAccount>,
    vault_bump: u8,
    destination: &Account<'info, TokenAccount>,
    rent_recipient: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    let unclaimed_funds_key = unclaimed_funds.key();
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, unclaimed_funds_key.as_ref(), &[vault_bump]];

    token::transfer(
        CpiContext::new(
            token_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: destination.to_account_info(),
                authority: vault.to_account_info(),
            },
        )
        .with_signer(&[signer_seeds]),
        vault.amount,
    )?;

    token::close_account(
        CpiContext::new(
            token_program.key(),
            CloseAccount {
                account: vault.to_account_info(),
                destination: rent_recipient.to_account_info(),
                authority: vault.to_account_info(),
            },
        )
        .with_signer(&[signer_seeds]),
    )
}

#[account]
#[derive(InitSpace)]
pub struct UnclaimedFunds {
    pub sender: Pubkey,
    pub link: Pubkey,
    pub mint: Pubkey,
    pub rent_recipient: Pubkey,
    pub amount: u64,
    pub reclaimable_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 16], link: Pubkey)]
pub struct Create<'info> {
    pub sender: Signer<'info>,
    #[account(mut)]
    pub rent_recipient: Signer<'info>,
    #[account(
        init,
        payer = rent_recipient,
        space = 8 + UnclaimedFunds::INIT_SPACE,
        seeds = [UNCLAIMED_FUNDS_SEED, sender.key().as_ref(), link.as_ref(), order_id.as_ref()],
        bump,
    )]
    pub unclaimed_funds: Account<'info, UnclaimedFunds>,
    /// CHECK: created and initialized as a token account owned by itself in `create`.
    #[account(mut, seeds = [VAULT_SEED, unclaimed_funds.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(address = USDC_MINT)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = sender)]
    pub source: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub link: Signer<'info>,
    #[account(
        mut,
        has_one = link @ OrchidLinksError::WrongSigner,
        has_one = rent_recipient @ OrchidLinksError::WrongRentRecipient,
        close = rent_recipient,
    )]
    pub unclaimed_funds: Account<'info, UnclaimedFunds>,
    #[account(mut, seeds = [VAULT_SEED, unclaimed_funds.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = USDC_MINT, constraint = destination.key() != vault.key() @ OrchidLinksError::DestinationIsVault)]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: must equal the rent recipient stored at creation.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    pub sender: Signer<'info>,
    #[account(
        mut,
        has_one = sender @ OrchidLinksError::WrongSigner,
        has_one = rent_recipient @ OrchidLinksError::WrongRentRecipient,
        close = rent_recipient,
    )]
    pub unclaimed_funds: Account<'info, UnclaimedFunds>,
    #[account(mut, seeds = [VAULT_SEED, unclaimed_funds.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = USDC_MINT, constraint = destination.key() != vault.key() @ OrchidLinksError::DestinationIsVault)]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: must equal the rent recipient stored at creation.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum OrchidLinksError {
    #[msg("The amount must be greater than zero")]
    ZeroAmount,
    #[msg("The link key must differ from the sender")]
    LinkIsSender,
    #[msg("The unclaimed funds cannot be reclaimed yet")]
    NotYetReclaimable,
    #[msg("The signer does not control these unclaimed funds")]
    WrongSigner,
    #[msg("The rent recipient differs from the one stored at creation")]
    WrongRentRecipient,
    #[msg("The destination cannot be the vault")]
    DestinationIsVault,
    #[msg("The reclaim time overflows the clock")]
    ClockOverflow,
}
