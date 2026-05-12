use anchor_lang::prelude::*;
use std::str::FromStr;

declare_id!("G2usi3gnE1NVm9DmTEcChvbkDc6YY9eRYyxF8uJSS4CZ");

#[program]
pub mod trade_execution {
    use super::*;

    pub fn initialize_multisig(
        ctx: Context<InitializeMultisig>,
        owners: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        require!(!owners.is_empty(), TradeError::NoOwners);
        require!(
            owners.len() <= MultisigConfig::MAX_OWNERS,
            TradeError::TooManyOwners
        );
        require!(
            threshold > 0 && usize::from(threshold) <= owners.len(),
            TradeError::InvalidThreshold
        );
        ensure_unique_owners(&owners)?;

        let multisig = &mut ctx.accounts.multisig;
        multisig.authority = ctx.accounts.authority.key();
        multisig.owners = owners;
        multisig.threshold = threshold;
        multisig.bump = ctx.bumps.multisig;
        multisig.max_slippage_bps = 100;
        multisig.max_oracle_deviation_bps = 150;
        multisig.allowed_dex_mask = DexSource::all_mask();
        multisig.trade_count = 0;

        emit!(MultisigInitialized {
            multisig: multisig.key(),
            authority: multisig.authority,
            threshold,
        });

        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        max_slippage_bps: u16,
        max_oracle_deviation_bps: u16,
        allowed_dex_mask: u8,
    ) -> Result<()> {
        require!(max_slippage_bps <= 5_000, TradeError::InvalidSlippage);
        require!(
            max_oracle_deviation_bps <= 5_000,
            TradeError::InvalidOracleDeviation
        );
        require!(allowed_dex_mask != 0, TradeError::NoDexAllowed);

        let multisig = &mut ctx.accounts.multisig;
        multisig.max_slippage_bps = max_slippage_bps;
        multisig.max_oracle_deviation_bps = max_oracle_deviation_bps;
        multisig.allowed_dex_mask = allowed_dex_mask;

        emit!(PolicyUpdated {
            multisig: multisig.key(),
            max_slippage_bps,
            max_oracle_deviation_bps,
            allowed_dex_mask,
        });

        Ok(())
    }

    pub fn open_trade(ctx: Context<OpenTrade>, params: TradeParams) -> Result<()> {
        let multisig = &mut ctx.accounts.multisig;
        require!(
            params.max_slippage_bps <= multisig.max_slippage_bps,
            TradeError::InvalidSlippage
        );
        require!(
            multisig.is_dex_allowed(params.dex_source),
            TradeError::DexNotAllowed
        );
        require!(params.amount_in > 0, TradeError::InvalidAmount);
        require!(params.min_out > 0, TradeError::InvalidAmount);
        require!(params.oracle_price > 0, TradeError::InvalidOraclePrice);

        let clock = Clock::get()?;
        let record = &mut ctx.accounts.trade_record;
        record.multisig = multisig.key();
        record.trader = ctx.accounts.trader.key();
        record.trade_id = params.trade_id;
        record.input_mint = params.input_mint;
        record.output_mint = params.output_mint;
        record.side = params.side;
        record.dex_source = params.dex_source;
        record.status = TradeStatus::Pending;
        record.amount_in = params.amount_in;
        record.min_out = params.min_out;
        record.output_amount = 0;
        record.oracle_price = params.oracle_price;
        record.execution_price = 0;
        record.max_slippage_bps = params.max_slippage_bps;
        record.route_hash = params.route_hash;
        record.execution_signature = [0; 64];
        record.approvals = Vec::new();
        record.created_at = clock.unix_timestamp;
        record.executed_at = 0;
        record.history_index = multisig.trade_count;
        record.bump = ctx.bumps.trade_record;
        multisig.trade_count = multisig
            .trade_count
            .checked_add(1)
            .ok_or(TradeError::MathOverflow)?;

        emit!(TradeOpened {
            trade_record: record.key(),
            multisig: record.multisig,
            trader: record.trader,
            dex_source: record.dex_source,
            amount_in: record.amount_in,
            min_out: record.min_out,
            oracle_price: record.oracle_price,
            route_hash: record.route_hash,
        });

        Ok(())
    }

    pub fn approve_trade(ctx: Context<ApproveTrade>) -> Result<()> {
        let multisig = &ctx.accounts.multisig;
        let owner = ctx.accounts.owner.key();
        require!(multisig.owners.contains(&owner), TradeError::UnauthorizedOwner);

        let record = &mut ctx.accounts.trade_record;
        require_keys_eq!(record.multisig, multisig.key(), TradeError::InvalidMultisig);
        require!(
            record.status == TradeStatus::Pending || record.status == TradeStatus::Approved,
            TradeError::TradeNotPending
        );
        require!(
            record.approvals.len() < TradeRecord::MAX_APPROVALS,
            TradeError::TooManyApprovals
        );

        if !record.approvals.contains(&owner) {
            record.approvals.push(owner);
        }

        if record.approvals.len() >= usize::from(multisig.threshold) {
            record.status = TradeStatus::Approved;
        }

        emit!(TradeApproved {
            trade_record: record.key(),
            owner,
            approvals: record.approvals.len() as u8,
            threshold: multisig.threshold,
            status: record.status,
        });

        Ok(())
    }

    pub fn execute_trade(ctx: Context<ExecuteTrade>, report: ExecutionReport) -> Result<()> {
        let multisig = &ctx.accounts.multisig;
        let record = &mut ctx.accounts.trade_record;
        require_keys_eq!(record.multisig, multisig.key(), TradeError::InvalidMultisig);
        require!(record.status == TradeStatus::Approved, TradeError::TradeNotApproved);
        require!(report.output_amount >= record.min_out, TradeError::SlippageExceeded);
        require!(report.execution_price > 0, TradeError::InvalidExecutionPrice);
        require_keys_eq!(
            report.input_mint,
            record.input_mint,
            TradeError::InvalidMint
        );
        require_keys_eq!(
            report.output_mint,
            record.output_mint,
            TradeError::InvalidMint
        );
        require!(
            report.route_hash == record.route_hash,
            TradeError::RouteHashMismatch
        );

        validate_dex_program(ctx.remaining_accounts, record.dex_source)?;
        verify_price_deviation(
            record.oracle_price,
            report.execution_price,
            multisig.max_oracle_deviation_bps,
        )?;

        record.status = TradeStatus::Executed;
        record.output_amount = report.output_amount;
        record.execution_price = report.execution_price;
        record.execution_signature = report.execution_signature;
        record.executed_at = Clock::get()?.unix_timestamp;

        emit!(TradeExecuted {
            trade_record: record.key(),
            executor: ctx.accounts.executor.key(),
            dex_source: record.dex_source,
            amount_in: record.amount_in,
            output_amount: record.output_amount,
            oracle_price: record.oracle_price,
            execution_price: record.execution_price,
            execution_signature: record.execution_signature,
        });

        Ok(())
    }

    pub fn cancel_trade(ctx: Context<CancelTrade>) -> Result<()> {
        let record = &mut ctx.accounts.trade_record;
        require!(
            record.status == TradeStatus::Pending || record.status == TradeStatus::Approved,
            TradeError::TradeAlreadyFinalized
        );
        record.status = TradeStatus::Cancelled;

        emit!(TradeCancelled {
            trade_record: record.key(),
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeMultisig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = MultisigConfig::LEN,
        seeds = [b"multisig", authority.key().as_ref()],
        bump
    )]
    pub multisig: Account<'info, MultisigConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub multisig: Account<'info, MultisigConfig>,
}

#[derive(Accounts)]
#[instruction(params: TradeParams)]
pub struct OpenTrade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub multisig: Account<'info, MultisigConfig>,
    #[account(
        init,
        payer = trader,
        space = TradeRecord::LEN,
        seeds = [b"trade", multisig.key().as_ref(), params.trade_id.as_ref()],
        bump
    )]
    pub trade_record: Account<'info, TradeRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveTrade<'info> {
    pub owner: Signer<'info>,
    pub multisig: Account<'info, MultisigConfig>,
    #[account(mut)]
    pub trade_record: Account<'info, TradeRecord>,
}

#[derive(Accounts)]
pub struct ExecuteTrade<'info> {
    pub executor: Signer<'info>,
    pub multisig: Account<'info, MultisigConfig>,
    #[account(mut)]
    pub trade_record: Account<'info, TradeRecord>,
}

#[derive(Accounts)]
pub struct CancelTrade<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority)]
    pub multisig: Account<'info, MultisigConfig>,
    #[account(mut)]
    pub trade_record: Account<'info, TradeRecord>,
}

#[account]
pub struct MultisigConfig {
    pub authority: Pubkey,
    pub owners: Vec<Pubkey>,
    pub threshold: u8,
    pub bump: u8,
    pub max_slippage_bps: u16,
    pub max_oracle_deviation_bps: u16,
    pub allowed_dex_mask: u8,
    pub trade_count: u64,
}

impl MultisigConfig {
    pub const MAX_OWNERS: usize = 10;
    pub const LEN: usize = 8 + 32 + 4 + (Self::MAX_OWNERS * 32) + 1 + 1 + 2 + 2 + 1 + 8 + 32;

    pub fn is_dex_allowed(&self, dex_source: DexSource) -> bool {
        self.allowed_dex_mask & dex_source.mask() != 0
    }
}

#[account]
pub struct TradeRecord {
    pub multisig: Pubkey,
    pub trader: Pubkey,
    pub trade_id: [u8; 32],
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub side: TradeSide,
    pub dex_source: DexSource,
    pub status: TradeStatus,
    pub amount_in: u64,
    pub min_out: u64,
    pub output_amount: u64,
    pub oracle_price: i64,
    pub execution_price: i64,
    pub max_slippage_bps: u16,
    pub route_hash: [u8; 32],
    pub execution_signature: [u8; 64],
    pub approvals: Vec<Pubkey>,
    pub created_at: i64,
    pub executed_at: i64,
    pub history_index: u64,
    pub bump: u8,
}

impl TradeRecord {
    pub const MAX_APPROVALS: usize = MultisigConfig::MAX_OWNERS;
    pub const LEN: usize = 8 + (32 * 6) + 64 + 3 + (8 * 8) + 2 + 4 + (Self::MAX_APPROVALS * 32) + 1 + 64;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TradeParams {
    pub trade_id: [u8; 32],
    pub side: TradeSide,
    pub dex_source: DexSource,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    pub min_out: u64,
    pub oracle_price: i64,
    pub limit_price: i64,
    pub max_slippage_bps: u16,
    pub route_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecutionReport {
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub output_amount: u64,
    pub execution_price: i64,
    pub route_hash: [u8; 32],
    pub execution_signature: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DexSource {
    Jupiter,
    Raydium,
    Orca,
}

impl DexSource {
    pub fn mask(self) -> u8 {
        match self {
            DexSource::Jupiter => 1,
            DexSource::Raydium => 1 << 1,
            DexSource::Orca => 1 << 2,
        }
    }

    pub fn all_mask() -> u8 {
        DexSource::Jupiter.mask() | DexSource::Raydium.mask() | DexSource::Orca.mask()
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TradeStatus {
    Pending,
    Approved,
    Executed,
    Cancelled,
}

#[event]
pub struct MultisigInitialized {
    pub multisig: Pubkey,
    pub authority: Pubkey,
    pub threshold: u8,
}

#[event]
pub struct PolicyUpdated {
    pub multisig: Pubkey,
    pub max_slippage_bps: u16,
    pub max_oracle_deviation_bps: u16,
    pub allowed_dex_mask: u8,
}

#[event]
pub struct TradeOpened {
    pub trade_record: Pubkey,
    pub multisig: Pubkey,
    pub trader: Pubkey,
    pub dex_source: DexSource,
    pub amount_in: u64,
    pub min_out: u64,
    pub oracle_price: i64,
    pub route_hash: [u8; 32],
}

#[event]
pub struct TradeApproved {
    pub trade_record: Pubkey,
    pub owner: Pubkey,
    pub approvals: u8,
    pub threshold: u8,
    pub status: TradeStatus,
}

#[event]
pub struct TradeExecuted {
    pub trade_record: Pubkey,
    pub executor: Pubkey,
    pub dex_source: DexSource,
    pub amount_in: u64,
    pub output_amount: u64,
    pub oracle_price: i64,
    pub execution_price: i64,
    pub execution_signature: [u8; 64],
}

#[event]
pub struct TradeCancelled {
    pub trade_record: Pubkey,
    pub authority: Pubkey,
}

fn ensure_unique_owners(owners: &[Pubkey]) -> Result<()> {
    for (index, owner) in owners.iter().enumerate() {
        require!(*owner != Pubkey::default(), TradeError::InvalidOwner);
        require!(
            !owners.iter().skip(index + 1).any(|candidate| candidate == owner),
            TradeError::DuplicateOwner
        );
    }

    Ok(())
}

fn verify_price_deviation(oracle_price: i64, execution_price: i64, max_deviation_bps: u16) -> Result<()> {
    require!(oracle_price > 0, TradeError::InvalidOraclePrice);
    require!(execution_price > 0, TradeError::InvalidExecutionPrice);

    let diff = oracle_price.abs_diff(execution_price) as u128;
    let deviation_bps = diff
        .checked_mul(10_000)
        .ok_or(TradeError::MathOverflow)?
        .checked_div(oracle_price as u128)
        .ok_or(TradeError::MathOverflow)?;

    require!(
        deviation_bps <= u128::from(max_deviation_bps),
        TradeError::OracleDeviationExceeded
    );

    Ok(())
}

fn validate_dex_program(remaining_accounts: &[AccountInfo<'_>], dex_source: DexSource) -> Result<()> {
    let dex_program = remaining_accounts.first().ok_or(TradeError::DexProgramMissing)?;
    require!(dex_program.executable, TradeError::InvalidDexProgram);

    let actual = dex_program.key();
    let allowed = match dex_source {
        DexSource::Jupiter => vec![parse_pubkey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")?],
        DexSource::Raydium => vec![
            parse_pubkey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8")?,
            parse_pubkey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")?,
            parse_pubkey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C")?,
        ],
        DexSource::Orca => vec![parse_pubkey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc")?],
    };

    require!(allowed.contains(&actual), TradeError::InvalidDexProgram);

    Ok(())
}

fn parse_pubkey(value: &str) -> Result<Pubkey> {
    Pubkey::from_str(value).map_err(|_| error!(TradeError::InvalidDexProgram))
}

#[error_code]
pub enum TradeError {
    #[msg("At least one multisig owner is required")]
    NoOwners,
    #[msg("Too many multisig owners")]
    TooManyOwners,
    #[msg("Multisig threshold is invalid")]
    InvalidThreshold,
    #[msg("Owner cannot be the default public key")]
    InvalidOwner,
    #[msg("Duplicate owner in multisig configuration")]
    DuplicateOwner,
    #[msg("Signer is not an authorized multisig owner")]
    UnauthorizedOwner,
    #[msg("Invalid multisig account")]
    InvalidMultisig,
    #[msg("Invalid slippage configuration")]
    InvalidSlippage,
    #[msg("Invalid oracle deviation configuration")]
    InvalidOracleDeviation,
    #[msg("No DEX source is allowed")]
    NoDexAllowed,
    #[msg("DEX source is not allowed")]
    DexNotAllowed,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Invalid execution price")]
    InvalidExecutionPrice,
    #[msg("Trade is not pending")]
    TradeNotPending,
    #[msg("Trade is not approved")]
    TradeNotApproved,
    #[msg("Trade has already been finalized")]
    TradeAlreadyFinalized,
    #[msg("Too many approvals")]
    TooManyApprovals,
    #[msg("Slippage check failed")]
    SlippageExceeded,
    #[msg("Execution route hash does not match proposal")]
    RouteHashMismatch,
    #[msg("Execution mint does not match proposal")]
    InvalidMint,
    #[msg("DEX program account is missing")]
    DexProgramMissing,
    #[msg("DEX program account is invalid")]
    InvalidDexProgram,
    #[msg("Execution price deviates too far from oracle")]
    OracleDeviationExceeded,
    #[msg("Math overflow")]
    MathOverflow,
}
