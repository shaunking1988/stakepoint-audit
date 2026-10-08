use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{AssociatedToken, Create as CreateAssociatedToken, create_idempotent as create_ata_idempotent, get_associated_token_address_with_program_id};
use anchor_spl::token::{self as token, Token};
use anchor_spl::token_interface::{
    self as token_interface,
    Mint,
    TokenAccount,
    TokenInterface,
    TransferChecked,
    transfer_checked,
};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use std::str::FromStr;

declare_id!("gLHaGJsZ6G7AXZxoDL9EsSWkRbKAWhFHi73gVfNXuzK");

const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 days

// Returns true if the mint is Native SOL
fn is_native_sol(mint: &Pubkey) -> bool {
    mint.to_string() == "So11111111111111111111111111111111111111112"
}

fn transfer_tokens<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    if is_native_sol(&mint.key()) {
        // Native SOL is not a supported staking or reward asset.
        let _ = &system_program;
        return Err(ErrorCode::NativeSolUnsupported.into());
    } else {
        // SPL Token or Token-2022 transfer
        msg!("🪙 Transferring SPL/Token-2022: {} units", amount);
        let transfer_ix = TransferChecked {
            from,
            to,
            authority,
            mint: mint.to_account_info(),
        };
        
        if let Some(seeds) = signer_seeds {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(token_program, transfer_ix, seeds),
                amount,
                mint.decimals,
            )?;
        } else {
            token_interface::transfer_checked(
                CpiContext::new(token_program, transfer_ix),
                amount,
                mint.decimals,
            )?;
        }
    }
    
    Ok(())
}

#[program]
pub mod staking_program {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        platform_token_fee_bps: u64,
        platform_sol_fee: u64,
    ) -> Result<()> {
        let platform = &mut ctx.accounts.platform;
        
        platform.admin = ctx.accounts.admin.key();
        platform.fee_collector = ctx.accounts.fee_collector.key();
        platform.platform_token_fee_bps = platform_token_fee_bps;
        platform.platform_sol_fee = platform_sol_fee;
        platform.is_initialized = true;
        platform.bump = ctx.bumps.platform;
        
        emit!(PlatformInitialized {
            admin: platform.admin,
            fee_collector: platform.fee_collector,
            platform_token_fee_bps,
            platform_sol_fee,
        });
        
        Ok(())
    }

    pub fn create_project(
        ctx: Context<CreateProject>,
        token_mint: Pubkey,
        pool_id: u64,
    ) -> Result<()> {
        require!(
            token_mint == ctx.accounts.token_mint.key(),
            ErrorCode::MintArgumentMismatch
        );
        require!(!is_native_sol(&token_mint), ErrorCode::NativeSolUnsupported);

        let project = &mut ctx.accounts.project;
        
        project.admin = ctx.accounts.admin.key();
        project.token_mint = token_mint;
        project.pool_id = pool_id;
        project.staking_vault = ctx.accounts.staking_vault.key();
        project.reward_vault = ctx.accounts.reward_vault.key();
        project.reflection_token = None;
        
        project.total_staked = 0;
        project.total_rewards_deposited = 0;
        project.total_rewards_claimed = 0;
        
        project.rate_bps_per_year = 0;
        project.rate_mode = 0;
        project.reward_rate_per_second = 0;
        project.lockup_seconds = 0;
        project.pool_duration_seconds = 0;
        project.pool_start_time = 0;
        project.pool_end_time = 0;
        
        project.last_update_time = 0;
        project.reward_per_token_stored = 0;
        project.reflection_per_token_stored = 0;
        project.last_reflection_update_time = 0;
        project.last_reflection_balance = 0;  // Initialize reflection balance tracker
        
        project.referrer = None;
        project.referrer_split_bps = 0;
        
        project.is_paused = false;
        project.deposit_paused = false;
        project.withdraw_paused = false;
        project.claim_paused = false;
        project.is_initialized = false;
        
        project.bump = ctx.bumps.project;
        project.total_reflection_debt = 0;  // ✅ ADD: Initialize debt tracking
        
        emit!(ProjectCreated {
            project: project.key(),
            token_mint,
            staking_vault: ctx.accounts.staking_vault.key(),
            reward_vault: ctx.accounts.reward_vault.key(),
            admin: ctx.accounts.admin.key(),
        });
        
        Ok(())
    }

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        token_mint: Pubkey,
        pool_id: u64,
        params: InitializePoolParams,
    ) -> Result<()> {
        let project = &mut ctx.accounts.project;
        
        require!(!project.is_initialized, ErrorCode::AlreadyInitialized);
        require!(
            params.pool_duration_seconds > 0,
            ErrorCode::InvalidPoolDuration
        );
        
        // Validate that passed parameters match the project
        require!(
            project.token_mint == token_mint,
            ErrorCode::WrongTokenType
        );
        require!(
            project.pool_id == pool_id,
            ErrorCode::InvalidProject
        );
        
        // Basic validation
        require!(
            params.rate_bps_per_year <= 1_000_000,
            ErrorCode::InvalidRateBps
        );

        require!(params.rate_mode == 0 || params.rate_mode == 1, ErrorCode::InvalidRateMode);

        if params.referrer_split_bps.is_some() {
            require!(
                params.referrer_split_bps.unwrap() <= 10000,
                ErrorCode::InvalidReferrerSplit
            );
        }
        
        let current_time = Clock::get()?.unix_timestamp;
        
        require!(params.lockup_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);
        require!(params.pool_duration_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);

        // Set pool configuration
        project.rate_mode = params.rate_mode;
        project.rate_bps_per_year = params.rate_bps_per_year;
        project.lockup_seconds = params.lockup_seconds;
        project.pool_duration_seconds = params.pool_duration_seconds;
        project.pool_start_time = current_time;
        project.pool_end_time = current_time
            .checked_add(params.pool_duration_seconds as i64)
            .ok_or(ErrorCode::MathOverflow)?;
        
        project.last_update_time = current_time;
        project.last_reflection_update_time = current_time;
        
        // Calculate reward rate for fixed APY pools
        if params.rate_mode == 0 {
            // Fixed APY pool - multiply by 1e9
            let numerator = (params.rate_bps_per_year as u128)
                .checked_mul(1_000_000_000u128)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let denominator = (10_000u128)
                .checked_mul(31_536_000u128)
                .ok_or(ErrorCode::MathOverflow)?;
                
            let rate_per_second = numerator
                .checked_div(denominator)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            require!(rate_per_second <= u64::MAX as u128, ErrorCode::AprTooHigh);
            project.reward_rate_per_second = rate_per_second as u64;
            
            msg!("Fixed APY pool rate: {}", project.reward_rate_per_second);
        }
        
        // Set referrer if provided
        if let Some(referrer) = params.referrer {
            project.referrer = Some(referrer);
            project.referrer_split_bps = params.referrer_split_bps.unwrap_or(0);
        }
        
        // ✅ HANDLE REFLECTIONS - ALL THREE TYPES (Native SOL, SPL, Self)
        project.enable_reflections = params.enable_reflections;
        
        if params.enable_reflections {
            require!(
                params.reflection_token.is_some(),
                ErrorCode::ReflectionTokenRequired
            );
            
            let reflection_token = params.reflection_token.unwrap();
            project.reflection_token = Some(reflection_token);
            
            // Check reflection type
            let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
            let is_native_sol = reflection_token == native_sol;
            let is_same_token = reflection_token == token_mint;
            
            if is_native_sol {
                // ✅ CASE 1: Native SOL reflections → Project PDA lamports
                msg!("✅ Native SOL reflections enabled");
                msg!("   Reflections will accumulate in Project PDA lamports");
                msg!("   Project PDA: {}", project.key());
                msg!("   No separate account creation needed");
                
                // Native SOL reflections accrue as lamports on the project PDA
                project.reflection_vault = Some(project.key());
                msg!("✅ Stored Project PDA as reflection vault: {}", project.key());
                
            } else {
                // ✅ CASE 2 & 3: SPL/Token-2022 reflections (external or self)
                msg!("✅ SPL/Token-2022 reflections enabled");
                if is_same_token {
                    msg!("   Type: Self-reflection (same token as staking)");
                    msg!("   Creating separate standard ATA for reflections");
                } else {
                    msg!("   Type: External reflection (different token)");
                }
                msg!("   Reflection token: {}", reflection_token);
                msg!("   Owner: Project PDA ({})", project.key());
                
                let bump = project.bump;
                let pool_id_bytes = pool_id.to_le_bytes();
                
                let seeds = &[
                    b"project",
                    token_mint.as_ref(),
                    pool_id_bytes.as_ref(),
                    &[bump],
                ];
                let signer_seeds = &[&seeds[..]];
                
                // ✅ Create standard ATA owned by Project PDA using CPI
                let reflection_token_account = ctx.accounts.reflection_token_account.as_ref()
                    .ok_or(ErrorCode::ReflectionVaultRequired)?;
                let reflection_token_mint = ctx.accounts.reflection_token_mint.as_ref()
                    .ok_or(ErrorCode::ReflectionTokenRequired)?;
                let reflection_token_program = ctx.accounts.reflection_token_program.as_ref()
                    .ok_or(ErrorCode::ReflectionTokenRequired)?;
                let associated_token_program = ctx.accounts.associated_token_program.as_ref()
                    .ok_or(ErrorCode::MissingAssociatedTokenProgram)?;

                // Fail early on a wrong program or a non mint account rather
                // than relying on the CPI to notice.
                require!(
                    associated_token_program.key() == anchor_spl::associated_token::ID,
                    ErrorCode::MissingAssociatedTokenProgram
                );
                require!(
                    reflection_token_program.key() == anchor_spl::token::ID
                        || reflection_token_program.key() == anchor_spl::token_2022::ID,
                    ErrorCode::ReflectionTokenRequired
                );
                require!(
                    reflection_token_mint.owner == reflection_token_program.key,
                    ErrorCode::ReflectionTokenRequired
                );

                let cpi_accounts = CreateAssociatedToken {
                    payer: ctx.accounts.admin.to_account_info(),
                    associated_token: reflection_token_account.to_account_info(),
                    authority: project.to_account_info(),
                    mint: reflection_token_mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: reflection_token_program.to_account_info(),
                };

                let cpi_ctx = CpiContext::new_with_signer(
                    associated_token_program.to_account_info(),
                    cpi_accounts,
                    signer_seeds,
                );

                create_ata_idempotent(cpi_ctx)?;

                // Idempotent create succeeds when the account already exists,
                // so confirm it really is the project's account for the
                // reflection mint before storing it.
                {
                    let data = reflection_token_account.try_borrow_data()?;
                    require!(data.len() >= 72, ErrorCode::InvalidReflectionVault);
                    let acc_mint = Pubkey::new_from_array(
                        data[0..32].try_into().unwrap()
                    );
                    let acc_owner = Pubkey::new_from_array(
                        data[32..64].try_into().unwrap()
                    );
                    require!(
                        acc_mint == reflection_token_mint.key() && acc_mint == reflection_token,
                        ErrorCode::ReflectionMintMismatch
                    );
                    require!(
                        acc_owner == project.key(),
                        ErrorCode::InvalidReflectionVault
                    );
                }

                msg!("✅ Reflection Vault ATA created: {}", reflection_token_account.key());
                
                // SPL reflections accrue in the project's ATA for the reflection mint
                project.reflection_vault = Some(reflection_token_account.key());
                msg!("✅ Stored reflection vault in project: {}", reflection_token_account.key());
            }
        } else {
            msg!("ℹ️ Reflections disabled for this pool");
        }
        
        project.is_initialized = true;
        project.total_reflection_debt = 0;
        
        emit!(PoolInitialized {
            project: project.key(),
            staking_vault: project.staking_vault,
            reward_vault: project.reward_vault,
            rate_bps_per_year: params.rate_bps_per_year,
            rate_mode: params.rate_mode,
            lockup_seconds: params.lockup_seconds,
            pool_duration_seconds: params.pool_duration_seconds,
            reflections_enabled: params.enable_reflections,
        });
        
        msg!("✅ Pool initialized successfully");
        msg!("   Rate mode: {}", project.rate_mode);
        msg!("   Lock period: {} seconds", project.lockup_seconds);
        msg!("   Pool duration: {} seconds", params.pool_duration_seconds);

        Ok(())
    }

    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        require!(
            ctx.accounts.staking_vault.key() == ctx.accounts.project.staking_vault,
            ErrorCode::UnauthorizedVault
        );
        let platform_token_fee_bps = ctx.accounts.platform.platform_token_fee_bps;
        let platform_sol_fee = ctx.accounts.platform.platform_sol_fee;
        let fee_collector = ctx.accounts.platform.fee_collector;
        
        let project_is_initialized = ctx.accounts.project.is_initialized;
        let project_is_paused = ctx.accounts.project.is_paused;
        let project_deposit_paused = ctx.accounts.project.deposit_paused;
        let project_pool_end_time = ctx.accounts.project.pool_end_time;
        let project_key = ctx.accounts.project.key();
        let project_token_mint = ctx.accounts.project.token_mint;
        let project_pool_id = ctx.accounts.project.pool_id;
        let project_bump = ctx.accounts.project.bump;
        let project_referrer = ctx.accounts.project.referrer;
        let project_referrer_split_bps = ctx.accounts.project.referrer_split_bps;
        let project_reward_per_token_stored = ctx.accounts.project.reward_per_token_stored;
        let project_reflection_per_token_stored = ctx.accounts.project.reflection_per_token_stored;
        
        require!(project_is_initialized, ErrorCode::NotInitialized);

        require!(!project_deposit_paused, ErrorCode::DepositsPaused);

        // Locks are single depositor. Each lock has its own project, so the only
        // valid depositor is the creator making the first deposit, or the same
        // owner adding to an existing position.
        if project_pool_id >= 1000 {
            require!(
                ctx.accounts.project.total_staked == 0 || ctx.accounts.stake.amount > 0,
                ErrorCode::LockNotOwnedByDepositor
            );
        }

        let rent_minimum = 890880u64;
        require!(
            ctx.accounts.user.lamports() >= platform_sol_fee.saturating_add(rent_minimum),
            ErrorCode::InsufficientSolForFee
        );
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < project_pool_end_time, ErrorCode::PoolEnded);
        
        let token_fee = ((amount as u128)
            .saturating_mul(platform_token_fee_bps as u128)
            / 10_000u128) as u64;
        
        let amount_after_fee = amount
            .checked_sub(token_fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // ✅ Detect if Native SOL or SPL token
        let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());

        // ✅ Get vault balance BEFORE transfer (handle both Native SOL and SPL)
        let vault_balance_before = if is_native {
            ctx.accounts.staking_vault.lamports()
        } else {
            // For SPL tokens, read amount from TokenAccount data
            let vault_data = ctx.accounts.staking_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };

        // ✅ Transfer tokens to staking vault (supports SPL, Token-2022, Native SOL)
        // Tax will be applied automatically by token program if token has transfer tax
        transfer_tokens(
            ctx.accounts.user_token_account.to_account_info(),
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.user.to_account_info(),
            &ctx.accounts.token_mint_account,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount_after_fee,
            None,
        )?;

        // ✅ Get vault balance AFTER transfer (handle both Native SOL and SPL)
        let vault_balance_after = if is_native {
            ctx.accounts.staking_vault.lamports()
        } else {
            // For SPL tokens, read amount from TokenAccount data
            let vault_data = ctx.accounts.staking_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };

        let actual_received = vault_balance_after
            .checked_sub(vault_balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("💰 Deposited {} tokens, vault received {} (after any transfer tax)", amount_after_fee, actual_received);
        
        let stake = &mut ctx.accounts.stake;
        let is_initialized = stake.bump != 0;

        if !is_initialized && ctx.accounts.project.enable_reflections {
            let reflection_vault_account = if let Some(ref vault) = ctx.accounts.reflection_vault {
                Some(vault.to_account_info())
            } else {
                Some(ctx.accounts.project.to_account_info())
            };
            update_reflection(&mut ctx.accounts.project, stake, reflection_vault_account.as_ref())?;
        }

        if !is_initialized {
    stake.user = ctx.accounts.user.key();
    stake.project = project_key;
    stake.amount = actual_received;  // ✅ Use actual amount received!
    stake.last_stake_timestamp = current_time;
    stake.withdrawal_wallet = ctx.accounts.user.key();
    stake.reward_per_token_paid = project_reward_per_token_stored;
    stake.rewards_pending = 0;
    stake.total_rewards_claimed = 0;
    stake.reflection_per_token_paid = ctx.accounts.project.reflection_per_token_stored;
    stake.reflections_pending = 0;
    stake.total_reflections_claimed = 0;
    stake.reflection_debt = 0;
    stake.reward_rate_snapshot = ctx.accounts.project.reward_rate_per_second;
    stake.bump = ctx.bumps.stake;
    
    // Credit the amount actually received, after any transfer tax
    let project_mut = &mut ctx.accounts.project;
    project_mut.total_staked = project_mut.total_staked
        .checked_add(actual_received)  // ✅ Use actual_received!
        .ok_or(ErrorCode::MathOverflow)?;
} else {
    require!(stake.user == ctx.accounts.user.key(), ErrorCode::Unauthorized);
    require!(stake.project == project_key, ErrorCode::InvalidProject);
    
    update_reward(&mut ctx.accounts.project, stake)?;
    
    // Only update reflections if enabled for this pool
    if ctx.accounts.project.enable_reflections {
        let reflection_vault_account = if let Some(ref vault) = ctx.accounts.reflection_vault {
            // SPL token reflections - separate vault provided
            Some(vault.to_account_info())
        } else {
            // Native SOL reflections - use project PDA
            Some(ctx.accounts.project.to_account_info())
        };
        update_reflection(&mut ctx.accounts.project, stake, reflection_vault_account.as_ref())?;
    }

    stake.amount = stake.amount
        .checked_add(actual_received)  // ✅ Use actual_received!
        .ok_or(ErrorCode::MathOverflow)?;
    
    let project_mut = &mut ctx.accounts.project;
    project_mut.total_staked = project_mut.total_staked
        .checked_add(actual_received)  // ✅ Use actual_received!
        .ok_or(ErrorCode::MathOverflow)?;
    
    stake.last_stake_timestamp = current_time;
}
        
        // ✅ Transfer token fee to fee collector
        if !is_native_sol(&ctx.accounts.token_mint_account.key()) {
            let expected_ata = get_associated_token_address_with_program_id(
                &fee_collector,
                &ctx.accounts.token_mint_account.key(),
                &ctx.accounts.token_program.key(),
            );
            require!(
                ctx.accounts.fee_collector_token_account.key() == expected_ata,
                ErrorCode::InvalidFeeCollector
            );
        }
        if token_fee > 0 {
            transfer_tokens(
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.fee_collector_token_account.to_account_info(),
                ctx.accounts.user.to_account_info(),
                &ctx.accounts.token_mint_account,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                token_fee,
                None,
            )?;
        }
        
        if platform_sol_fee > 0 {
            if let Some(referrer_key) = project_referrer {
                // Get referrer from remaining_accounts if present
                let referrer_account = if !ctx.remaining_accounts.is_empty() {
                    Some(&ctx.remaining_accounts[0])
                } else {
                    None
                };
                
                if let Some(referrer_account) = referrer_account {
                    require!(
                        referrer_account.key() == referrer_key,
                        ErrorCode::InvalidReferrer
                    );
                    
                    let referrer_amount = platform_sol_fee
                        .checked_mul(project_referrer_split_bps)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    let admin_amount = platform_sol_fee
                        .checked_sub(referrer_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        admin_amount,
                    )?;
                    
                    if referrer_amount > 0 {
                        system_program::transfer(
                            CpiContext::new(
                                ctx.accounts.system_program.to_account_info(),
                                system_program::Transfer {
                                    from: ctx.accounts.user.to_account_info(),
                                    to: referrer_account.to_account_info(),
                                },
                            ),
                            referrer_amount,
                        )?;
                    }
                } else {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        platform_sol_fee,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    platform_sol_fee,
                )?;
            }
        }
        
        emit!(TokensDeposited {
            user: ctx.accounts.user.key(),
            project: project_key,
            amount: actual_received,  // ✅ Emit actual received amount
            token_fee,
            sol_fee: platform_sol_fee,
            new_total: stake.amount,
        });
        
        Ok(())
    }

    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.stake.amount >= amount, ErrorCode::InsufficientBalance);
        
        // ✅ Access directly - no local variable copies
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        
        let rent_minimum = 890880u64;
        require!(
            ctx.accounts.user.lamports() >= ctx.accounts.platform.platform_sol_fee.saturating_add(rent_minimum),
            ErrorCode::InsufficientSolForFee
        );
        
        let token_fee = ((amount as u128)
            .saturating_mul(ctx.accounts.platform.platform_token_fee_bps as u128)
            / 10_000u128) as u64;
        
        let amount_after_fee = amount
            .checked_sub(token_fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(
            ctx.accounts.staking_vault.amount >= amount,
            ErrorCode::InsufficientVaultBalance
        );
        
        // ✅ Call updates early
        update_reward(&mut ctx.accounts.project, &mut ctx.accounts.stake)?;

        // Reflection overflow must never block a withdrawal
        match update_reflection(&mut ctx.accounts.project, &mut ctx.accounts.stake, ctx.accounts.reflection_vault.as_ref()) {
            Ok(()) => {}
            Err(e) if e == error!(ErrorCode::MathOverflow) => {
                msg!("⚠️ Reflection update skipped during withdraw");
            }
            Err(e) => return Err(e),
        }

        // Advance the reward accrual timestamp so repeated partial withdraws
        // cannot credit the same interval more than once.
        ctx.accounts.stake.reflection_debt = Clock::get()?.unix_timestamp as u64;

        let current_time = Clock::get()?.unix_timestamp;
        let time_staked = current_time
            .checked_sub(ctx.accounts.stake.last_stake_timestamp)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(time_staked >= 0, ErrorCode::InvalidTimestamp);
        
        if time_staked < ctx.accounts.project.lockup_seconds as i64 {
            return Err(ErrorCode::LockupNotExpired.into());
        }
        
        // Validate withdrawal destination belongs to staker or their withdrawal_wallet
        let dest_owner = if ctx.accounts.withdrawal_token_account.data_len() >= 32 {
            let data = ctx.accounts.withdrawal_token_account.try_borrow_data()?;
            Pubkey::try_from(&data[32..64]).unwrap_or_default()
        } else {
            ctx.accounts.withdrawal_token_account.key()
        };
        require!(
            dest_owner == ctx.accounts.user.key() || dest_owner == ctx.accounts.stake.withdrawal_wallet,
            ErrorCode::InvalidWithdrawalWallet
        );
        
        // Update stake amount
        ctx.accounts.stake.amount = ctx.accounts.stake.amount
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Update total staked
        require!(
            ctx.accounts.project.total_staked >= amount,
            ErrorCode::InconsistentTotalStaked
        );
        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // ✅ Only create seeds when needed
        let seeds = &[
            b"project",
            ctx.accounts.project.token_mint.as_ref(),
            &ctx.accounts.project.pool_id.to_le_bytes(),
            &[ctx.accounts.project.bump],
        ];
        let signer = &[&seeds[..]];
        
        // ✅ Transfer tokens to user (supports SPL, Token-2022, Native SOL)
        transfer_tokens(
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.withdrawal_token_account.to_account_info(),
            ctx.accounts.project.to_account_info(),
            &ctx.accounts.token_mint_account,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount_after_fee,
            Some(signer),
        )?;
        
        // ✅ Transfer token fee to fee collector
        if !is_native_sol(&ctx.accounts.token_mint_account.key()) {
            let expected_ata = get_associated_token_address_with_program_id(
                &ctx.accounts.platform.fee_collector,
                &ctx.accounts.token_mint_account.key(),
                &ctx.accounts.token_program.key(),
            );
            require!(
                ctx.accounts.fee_collector_token_account.key() == expected_ata,
                ErrorCode::InvalidFeeCollector
            );
        }
        if token_fee > 0 {
            transfer_tokens(
                ctx.accounts.staking_vault.to_account_info(),
                ctx.accounts.fee_collector_token_account.to_account_info(),
                ctx.accounts.project.to_account_info(),
                &ctx.accounts.token_mint_account,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                token_fee,
                Some(signer),
            )?;
        }
        
        // Collect SOL fee
        if ctx.accounts.platform.platform_sol_fee > 0 {
            if let Some(referrer_key) = ctx.accounts.project.referrer {
                // Get referrer from remaining_accounts if present
                let referrer_account = if !ctx.remaining_accounts.is_empty() {
                    Some(&ctx.remaining_accounts[0])
                } else {
                    None
                };
                
                if let Some(referrer_account) = referrer_account {
                    require!(
                        referrer_account.key() == referrer_key,
                        ErrorCode::InvalidReferrer
                    );
                    
                    let referrer_amount = ctx.accounts.platform.platform_sol_fee
                        .checked_mul(ctx.accounts.project.referrer_split_bps)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    let admin_amount = ctx.accounts.platform.platform_sol_fee
                        .checked_sub(referrer_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        admin_amount,
                    )?;
                    
                    if referrer_amount > 0 {
                        system_program::transfer(
                            CpiContext::new(
                                ctx.accounts.system_program.to_account_info(),
                                system_program::Transfer {
                                    from: ctx.accounts.user.to_account_info(),
                                    to: referrer_account.to_account_info(),
                                },
                            ),
                            referrer_amount,
                        )?;
                    }
                } else {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        ctx.accounts.platform.platform_sol_fee,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    ctx.accounts.platform.platform_sol_fee,
                )?;
            }
        }
        
        emit!(TokensWithdrawn {
            user: ctx.accounts.user.key(),
            project: ctx.accounts.project.key(),
            amount: amount_after_fee,
            remaining: ctx.accounts.stake.amount,
        });
        
        Ok(())
    }
    pub fn claim<'info>(
        ctx: Context<'_, '_, '_, 'info, Claim<'info>>,
        token_mint: Pubkey,
        pool_id: u64
    ) -> Result<()> {
    require!(ctx.accounts.stake.rewards_pending > 0 || ctx.accounts.stake.amount > 0, ErrorCode::NoStake);
    
    let platform_sol_fee = ctx.accounts.platform.platform_sol_fee;
    let fee_collector = ctx.accounts.platform.fee_collector;
    
    let project_is_initialized = ctx.accounts.project.is_initialized;
    let project_is_paused = ctx.accounts.project.is_paused;
    let project_token_mint = ctx.accounts.project.token_mint;
    let project_pool_id = ctx.accounts.project.pool_id;
    let project_bump = ctx.accounts.project.bump;
    let project_key = ctx.accounts.project.key();
    let project_referrer = ctx.accounts.project.referrer;
    let project_referrer_split_bps = ctx.accounts.project.referrer_split_bps;
    
    require!(project_is_initialized, ErrorCode::NotInitialized);
    require!(
        ctx.accounts.reward_vault.key() == ctx.accounts.project.reward_vault,
        ErrorCode::UnauthorizedVault
    );
    
    // Check user has enough SOL for fee
    let rent_minimum = 890880u64;
    require!(
        ctx.accounts.user.lamports() >= platform_sol_fee.saturating_add(rent_minimum),
        ErrorCode::InsufficientSolForFee
    );
    
    update_reward(&mut ctx.accounts.project, &mut ctx.accounts.stake)?;
    
    if ctx.accounts.project.enable_reflections && ctx.accounts.project.reflection_token.is_some() {
        if let Some(ref vault) = ctx.accounts.reflection_vault {
            update_reflection(&mut ctx.accounts.project, &mut ctx.accounts.stake, Some(&vault.to_account_info()))?;
        }
    }

    let rewards = ctx.accounts.stake.rewards_pending;
    require!(rewards > 0, ErrorCode::NoRewards);

    // Validate claim destination belongs to staker or their withdrawal_wallet
    let claim_dest_owner = if ctx.accounts.user_token_account.data_len() >= 32 {
        let data = ctx.accounts.user_token_account.try_borrow_data()?;
        Pubkey::try_from(&data[32..64]).unwrap_or_default()
    } else {
        ctx.accounts.user_token_account.key()
    };
    require!(
        claim_dest_owner == ctx.accounts.user.key() || claim_dest_owner == ctx.accounts.stake.withdrawal_wallet,
        ErrorCode::InvalidWithdrawalWallet
    );

    // Check reward vault balance (handle both Native SOL and SPL)
    let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());
    let vault_balance = if is_native {
        ctx.accounts.reward_vault.lamports()
    } else {
        let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
        u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
    };

    require!(
        vault_balance >= rewards,
        ErrorCode::InsufficientRewardVault
    );
    
    let stake_mut = &mut ctx.accounts.stake;
    stake_mut.rewards_pending = 0;
    stake_mut.last_stake_timestamp = Clock::get()?.unix_timestamp;
    stake_mut.total_rewards_claimed = stake_mut.total_rewards_claimed
        .checked_add(rewards)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let project_mut = &mut ctx.accounts.project;
    project_mut.total_rewards_claimed = project_mut.total_rewards_claimed
        .checked_add(rewards)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let seeds = &[
        b"project",
        project_token_mint.as_ref(),
        &project_pool_id.to_le_bytes(),
        &[project_bump],
    ];
    let signer = &[&seeds[..]];
    
    // ✅ Transfer rewards (supports SPL, Token-2022, Native SOL)
    transfer_tokens(
        ctx.accounts.reward_vault.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.project.to_account_info(),
        &ctx.accounts.token_mint_account,
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        rewards,
        Some(signer),
    )?;
    
    // Collect SOL fee (with referral split if applicable)
    if platform_sol_fee > 0 {
        if let Some(referrer_key) = project_referrer {
            // Get referrer from remaining_accounts if present
            let referrer_account = if !ctx.remaining_accounts.is_empty() {
                Some(&ctx.remaining_accounts[0])
            } else {
                None
            };
            
            if let Some(referrer_account) = referrer_account {
                require!(
                    referrer_account.key() == referrer_key,
                    ErrorCode::InvalidReferrer
                );
                
                let referrer_amount = platform_sol_fee
                    .checked_mul(project_referrer_split_bps)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(10000)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                let admin_amount = platform_sol_fee
                    .checked_sub(referrer_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    admin_amount,
                )?;
                
                if referrer_amount > 0 {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: referrer_account.to_account_info(),
                            },
                        ),
                        referrer_amount,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    platform_sol_fee,
                )?;
            }
        } else {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.fee_collector.to_account_info(),
                    },
                ),
                platform_sol_fee,
            )?;
        }
    }
    
    emit!(RewardsClaimed {
        user: ctx.accounts.user.key(),
        project: project_key,
        amount: rewards,
    });
    
    Ok(())
}

    pub fn claim_reflections(
        ctx: Context<ClaimReflections>,
        token_mint: Pubkey,
        pool_id: u64,
    ) -> Result<()> {
        
        require!(
            ctx.accounts.project.reflection_vault == Some(ctx.accounts.reflection_vault.key()),
            ErrorCode::InvalidReflectionVault
        );
        let project = &ctx.accounts.project;
        let stake = &mut ctx.accounts.stake;

        require!(project.is_initialized, ErrorCode::NotInitialized);

        require!(project.enable_reflections, ErrorCode::ReflectionsNotEnabled);
        require!(
            project.reflection_token.is_some(),
            ErrorCode::ReflectionTokenRequired
        );

        let reflection_token_mint = project.reflection_token.unwrap();
        let amount = stake.reflections_pending;

        require!(amount > 0, ErrorCode::NoReflectionsToClaim);

        // Check if it's Native SOL
        let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let is_native_sol = reflection_token_mint == native_sol;

        msg!("🎁 Claiming reflections:");
        msg!("   User: {}", ctx.accounts.user.key());
        msg!("   Amount: {}", amount);
        msg!("   Reflection token: {}", reflection_token_mint);
        msg!("   Type: {}", if is_native_sol { "Native SOL" } else { "SPL Token" });

        // Get decimals for transfer_checked (not needed for Native SOL)
        let decimals = if !is_native_sol {
            // Bind the supplied mint account to the configured reflection
            // token. Kept inside the SPL branch because the native path
            // never reads the mint account.
            require!(
                ctx.accounts.reflection_token_mint.key() == reflection_token_mint,
                ErrorCode::ReflectionMintMismatch
            );
            ctx.accounts.reflection_token_mint.decimals
        } else {
            9 // Native SOL has 9 decimals
        };

        // ✅ Apply 99.7% buffer for Native SOL to prevent rent issues
        let amount_to_transfer = if is_native_sol {
            amount.saturating_mul(997).saturating_div(1000) // 99.7%
        } else {
            amount
        };

        msg!("   Transfer amount (after buffer): {}", amount_to_transfer);

        // Get PDA seeds for signing
        let project_key = project.key();
        let project_bump = project.bump;
        let project_token_mint = project.token_mint;
        let project_pool_id = project.pool_id;
        
        let seeds = &[
            b"project",
            project_token_mint.as_ref(),
            &project_pool_id.to_le_bytes(),
            &[project_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // ✅ Transfer based on reflection type
        if is_native_sol {
            // ✅ Native SOL - manually transfer lamports from Project PDA
            msg!("💰 Transferring Native SOL lamports from Project PDA");
            
            // Manual lamport transfer (works for accounts with data)
            **ctx.accounts.reflection_vault.try_borrow_mut_lamports()? -= amount_to_transfer;
            **ctx.accounts.user_reflection_account.try_borrow_mut_lamports()? += amount_to_transfer;
            
            msg!("✅ Native SOL transferred successfully");
            
        } else {
            // ✅ SPL/Token-2022 - transfer from Project PDA's standard ATA
            msg!("🪙 Transferring SPL tokens from Project PDA's ATA");
            
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.reflection_vault.to_account_info(),
                        to: ctx.accounts.user_reflection_account.to_account_info(),
                        authority: ctx.accounts.project.to_account_info(),
                        mint: ctx.accounts.reflection_token_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount_to_transfer,
                decimals,
            )?;
            
            msg!("✅ SPL tokens transferred successfully");
        }

        // Reset pending reflections
        stake.reflections_pending = 0;
        stake.total_reflections_claimed = stake.total_reflections_claimed
            .checked_add(amount_to_transfer)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Update last balance to current vault balance
        let current_vault_balance = if is_native_sol {
            let total_lamports = ctx.accounts.reflection_vault.lamports();
            let rent = Rent::get()?;
            let rent_exempt_minimum = rent.minimum_balance(ctx.accounts.reflection_vault.data_len());
            let fixed_buffer = rent_exempt_minimum.saturating_add(3_000_000);
            total_lamports.saturating_sub(fixed_buffer)
        } else {
            let vault_data = ctx.accounts.reflection_vault.try_borrow_data()?;
            if vault_data.len() >= 72 {
                u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
            } else {
                0
            }
        };
        
        // Subtract only what actually left the vault, so any retained buffer
        // stays out of the next distribution.
        let project_mut = &mut ctx.accounts.project;
        project_mut.last_reflection_balance = project_mut
            .last_reflection_balance
            .saturating_sub(amount_to_transfer);

        msg!("✅ Reflections claimed successfully");
        msg!("   Amount transferred: {}", amount_to_transfer);
        msg!("   New vault balance: {}", current_vault_balance);
        
        emit!(ReflectionsClaimed {
            user: ctx.accounts.user.key(),
            project: project_key,
            amount: amount_to_transfer,
        });

        Ok(())
    }

    pub fn refresh_reflections(
        ctx: Context<RefreshReflections>,
        token_mint: Pubkey,
        pool_id: u64,
    ) -> Result<()> {
        require!(ctx.accounts.stake.amount > 0, ErrorCode::NoStake);
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);
        require!(ctx.accounts.project.enable_reflections, ErrorCode::ReflectionsNotEnabled);
        require!(
            ctx.accounts.project.reflection_token.is_some(),
            ErrorCode::ReflectionTokenRequired
        );

        let project = &ctx.accounts.project;
        let reflection_token_mint = project.reflection_token.unwrap();
        
        // Check if it's Native SOL
        let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let is_native_sol = reflection_token_mint == native_sol;

        msg!("🔄 Refreshing reflections:");
        msg!("   User: {}", ctx.accounts.user.key());
        msg!("   Reflection type: {}", if is_native_sol { "Native SOL" } else { "SPL Token" });
        msg!("   Reflection token: {}", reflection_token_mint);

        // Update reflection calculation - MUST update user paid marker to prevent double-counting
        update_reflection_internal(
            &mut ctx.accounts.project,
            &mut ctx.accounts.stake,
            Some(&ctx.accounts.reflection_vault.to_account_info()),
            true,
        )?;

        msg!("✅ Reflections refreshed");
        msg!("   Pending reflections: {}", ctx.accounts.stake.reflections_pending);
        msg!("   Last balance: {}", ctx.accounts.project.last_reflection_balance);

        Ok(())
    }

    pub fn deposit_rewards(
        ctx: Context<DepositRewards>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

    
    let project_key = ctx.accounts.project.key();
    
    // ✅ Detect if Native SOL or SPL token
    let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());

    // ✅ Get vault balance BEFORE transfer (handle both Native SOL and SPL)
    let reward_vault_balance_before = if is_native {
        ctx.accounts.reward_vault.lamports()
    } else {
        // For SPL tokens, read amount from TokenAccount data
        let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
        u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
    };

    // ✅ Transfer rewards to vault (supports SPL, Token-2022, Native SOL)
    // Tax will be applied automatically by token program if token has transfer tax
    transfer_tokens(
        ctx.accounts.admin_token_account.to_account_info(),
        ctx.accounts.reward_vault.to_account_info(),
        ctx.accounts.admin.to_account_info(),
        &ctx.accounts.token_mint_account,
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        amount,
        None,
    )?;

    // ✅ Get vault balance AFTER transfer (handle both Native SOL and SPL)
    let reward_vault_balance_after = if is_native {
        ctx.accounts.reward_vault.lamports()
    } else {
        // For SPL tokens, read amount from TokenAccount data
        let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
        u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
    };

    let actual_received = reward_vault_balance_after
        .checked_sub(reward_vault_balance_before)
        .ok_or(ErrorCode::MathOverflow)?;
    
    msg!("💰 Admin deposited {} rewards, vault received {} (after any transfer tax)", amount, actual_received);
    
    let project_mut = &mut ctx.accounts.project;
    project_mut.total_rewards_deposited = project_mut.total_rewards_deposited
        .checked_add(actual_received)  // ✅ Use actual_received!
        .ok_or(ErrorCode::MathOverflow)?;
    
    // For fixed APY pools (rate_mode = 0), rate was already set in initialize_pool
    match project_mut.rate_mode {
        0 => {
            // Fixed APY - rate already calculated in initialize_pool, don't recalculate
            msg!("Fixed APY pool - rate: {}", project_mut.reward_rate_per_second);
        }
        
        1 => {
            // Dynamic pool - recalculate based on total available rewards
            let total_available = project_mut.total_rewards_deposited
                .checked_sub(project_mut.total_rewards_claimed)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let current_time = Clock::get()?.unix_timestamp;
            let time_remaining = project_mut.pool_end_time
                .checked_sub(current_time)
                .unwrap_or(0);
            
            if time_remaining > 0 {
                let new_rate = total_available
                    .checked_div(time_remaining as u64)
                    .unwrap_or(0);

                // A deposit too small to emit even one unit per second would
                // be partly stranded.
                require!(
                    actual_received >= time_remaining as u64,
                    ErrorCode::ZeroRateIncrement
                );

                project_mut.reward_rate_per_second = new_rate;
            }
            
            msg!("Dynamic pool - new rate: {}", project_mut.reward_rate_per_second);
        }
        
        _ => return Err(ErrorCode::InvalidRateMode.into()),
    }
    
    emit!(RewardsDeposited {
        project: project_key,
        amount: actual_received,  // ✅ Emit actual received amount
        total_rewards: project_mut.total_rewards_deposited,
        reward_rate: project_mut.reward_rate_per_second,
    });
    
    Ok(())
}

    pub fn update_referrer(
        ctx: Context<UpdateReferrer>,
        token_mint: Pubkey,
        pool_id: u64,
        referrer: Option<Pubkey>,
        split_bps: u64,
    ) -> Result<()> {
        require!(split_bps <= 10000, ErrorCode::InvalidSplitPercentage);
        
        let project = &mut ctx.accounts.project;
        project.referrer = referrer;
        project.referrer_split_bps = split_bps;
        
        emit!(ReferrerUpdated {
            project: project.key(),
            referrer,
            split_bps,
        });
        
        Ok(())
    }

    pub fn set_fees(
        ctx: Context<SetFees>,
        platform_token_fee_bps: u64,
        platform_sol_fee: u64,
    ) -> Result<()> {
        require!(platform_token_fee_bps <= MAX_PLATFORM_FEE_BPS, ErrorCode::FeeTooHigh);
        require!(platform_sol_fee <= MAX_PLATFORM_SOL_FEE, ErrorCode::FeeTooHigh);

        let platform = &mut ctx.accounts.platform;
        platform.platform_token_fee_bps = platform_token_fee_bps;
        platform.platform_sol_fee = platform_sol_fee;
        
        emit!(FeesUpdated {
            platform_token_fee_bps,
            platform_sol_fee,
        });
        
        Ok(())
    }

    pub fn set_custom_fees1(
        ctx: Context<SetCustomFees1>,
        _token_mint: Pubkey,
        _pool_id: u64,
        use_custom_fees: bool,
        custom_token_fee_bps: u64,
        custom_sol_fee: u64,
    ) -> Result<()> {
        if use_custom_fees {
            require!(custom_token_fee_bps <= MAX_PLATFORM_FEE_BPS, ErrorCode::FeeTooHigh);
            require!(custom_sol_fee <= MAX_PLATFORM_SOL_FEE, ErrorCode::FeeTooHigh);
        }

        let project = &mut ctx.accounts.project;
        project.use_custom_fees = use_custom_fees;
        project.custom_token_fee_bps = if use_custom_fees { custom_token_fee_bps } else { 0 };
        project.custom_sol_fee = if use_custom_fees { custom_sol_fee } else { 0 };

        emit!(CustomFeesUpdated {
            project: project.key(),
            use_custom_fees,
            custom_token_fee_bps: project.custom_token_fee_bps,
            custom_sol_fee: project.custom_sol_fee,
        });

        Ok(())
    }

    pub fn transfer_admin(
        ctx: Context<TransferAdmin>,
        token_mint: Pubkey,
        pool_id: u64,
    ) -> Result<()> {
        let old_admin = ctx.accounts.project.admin;
        ctx.accounts.project.admin = ctx.accounts.new_admin.key();
        
        emit!(AdminTransferred {
            project: ctx.accounts.project.key(),
            old_admin,
            new_admin: ctx.accounts.new_admin.key(),
        });
        
        Ok(())
    }

    pub fn update_fee_collector(
        ctx: Context<UpdateFeeCollector>,
        new_fee_collector: Pubkey,
    ) -> Result<()> {
        let platform = &mut ctx.accounts.platform;
        let old_fee_collector = platform.fee_collector;
        platform.fee_collector = new_fee_collector;
        
        emit!(FeeCollectorUpdated {
            old_fee_collector,
            new_fee_collector,
        });
        
        Ok(())
    }

    pub fn transfer_platform_admin(
        ctx: Context<TransferPlatformAdmin>,
        new_admin: Pubkey,
    ) -> Result<()> {
        // Propose only. Nothing changes until the proposed wallet accepts.
        require!(new_admin != Pubkey::default(), ErrorCode::Unauthorized);

        let pending = &mut ctx.accounts.pending_admin;
        pending.pending = new_admin;
        pending.bump = ctx.bumps.pending_admin;

        emit!(PlatformAdminTransferProposed {
            current_admin: ctx.accounts.platform.admin,
            proposed_admin: new_admin,
        });

        Ok(())
    }

    pub fn accept_platform_admin(ctx: Context<AcceptPlatformAdmin>) -> Result<()> {
        let pending_key = ctx.accounts.pending_admin.pending;
        require!(
            pending_key == ctx.accounts.new_admin.key(),
            ErrorCode::Unauthorized
        );

        let platform = &mut ctx.accounts.platform;
        let old_admin = platform.admin;
        platform.admin = pending_key;

        let pending = &mut ctx.accounts.pending_admin;
        pending.pending = Pubkey::default();

        emit!(PlatformAdminTransferred {
            old_admin,
            new_admin: pending_key,
        });

        Ok(())
    }

    pub fn admin_set_reflection_token(
        ctx: Context<AdminSetReflectionToken>,
        token_mint: Pubkey,
        pool_id: u64,
    ) -> Result<()> {
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);
        require!(
            ctx.accounts.project.reflection_per_token_stored == 0
                && ctx.accounts.project.total_reflection_debt == 0,
            ErrorCode::ReflectionAlreadyAccrued
        );

        let project_key = ctx.accounts.project.key();
        let new_mint = ctx.accounts.reflection_token_mint.key();
        let passed_vault = ctx.accounts.reflection_token_account.key();
        let mint_ai = ctx.accounts.reflection_token_mint.to_account_info();

        let expected_vault = if is_native_sol(&new_mint) {
            project_key
        } else {
            let vault_ai = ctx.accounts.reflection_token_account.to_account_info();
            require!(!vault_ai.data_is_empty(), ErrorCode::InvalidReflectionVault);
            require!(vault_ai.owner == mint_ai.owner, ErrorCode::InvalidReflectionVault);
            get_associated_token_address_with_program_id(
                &project_key,
                &new_mint,
                mint_ai.owner,
            )
        };
        require!(passed_vault == expected_vault, ErrorCode::InvalidReflectionVault);

        let old_token = ctx.accounts.project.reflection_token;
        let old_vault = ctx.accounts.project.reflection_vault;

        let project = &mut ctx.accounts.project;
        project.reflection_token = Some(new_mint);
        project.reflection_vault = Some(passed_vault);
        project.enable_reflections = true;
        project.reflection_per_token_stored = 0;
        project.total_reflection_debt = 0;
        project.last_reflection_balance = 0;
        project.last_reflection_update_time = Clock::get()?.unix_timestamp;

        emit!(ReflectionTokenCorrected {
            project: project_key,
            old_token,
            new_token: new_mint,
            old_vault,
            new_vault: passed_vault,
        });

        Ok(())
    }

    pub fn extend_lock(
        ctx: Context<ExtendLock>,
        _token_mint: Pubkey,
        pool_id: u64,
        new_lockup_seconds: u64,
    ) -> Result<()> {
        // Locks only. Pools share the Project type and raising lockup_seconds
        // there would extend every staker's lock at once.
        require!(pool_id >= 1000, ErrorCode::NotALock);

        let project = &mut ctx.accounts.project;

        // Can only ever extend, never shorten
        require!(
            new_lockup_seconds > project.lockup_seconds,
            ErrorCode::LockCannotBeShortened
        );
        require!(new_lockup_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);

        let old = project.lockup_seconds;
        project.lockup_seconds = new_lockup_seconds;

        emit!(LockExtended {
            project: project.key(),
            user: ctx.accounts.user.key(),
            old_lockup_seconds: old,
            new_lockup_seconds,
        });

        Ok(())
    }

    pub fn set_crank_authority(
        ctx: Context<SetCrankAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let crank = &mut ctx.accounts.crank;
        crank.authority = new_authority;
        crank.bump = ctx.bumps.crank;
        msg!("Crank authority set to {}", new_authority);
        Ok(())
    }

    pub fn settle_stake(
        ctx: Context<SettleStake>,
        _token_mint: Pubkey,
        _pool_id: u64,
    ) -> Result<()> {
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        // Bank accrual to date at the conditions that actually applied over
        // the interval, then advance only the accrual marker. The lockup
        // clock is last_stake_timestamp and is deliberately untouched.
        let settle_now = Clock::get()?.unix_timestamp;
        let settle_marker = (ctx.accounts.stake.reflection_debt as i64)
            .max(ctx.accounts.stake.last_stake_timestamp);
        require!(
            settle_now.saturating_sub(settle_marker) >= 86_400,
            ErrorCode::InvalidTimestamp
        );

        update_reward(&mut ctx.accounts.project, &mut ctx.accounts.stake)?;
        ctx.accounts.stake.reflection_debt = settle_now as u64;

        Ok(())
    }

    pub fn set_deposit_paused(
        ctx: Context<SetDepositPaused>,
        _token_mint: Pubkey,
        _pool_id: u64,
        paused: bool,
    ) -> Result<()> {
        ctx.accounts.project.deposit_paused = paused;
        msg!("Deposit paused set to {}", paused);
        Ok(())
    }

    pub fn register_extra_reward(
        ctx: Context<RegisterExtraReward>,
        _token_mint: Pubkey,
        _pool_id: u64,
        beneficiary: Pubkey,
    ) -> Result<()> {
        let project = &ctx.accounts.project;
        let extra_mint = ctx.accounts.extra_mint.key();
        let mint_ai = ctx.accounts.extra_mint.to_account_info();

        // Native SOL has no token account, and the SOL path would move project lamports
        require!(!is_native_sol(&extra_mint), ErrorCode::ExtraRewardNativeSolUnsupported);

        // Must not collide with the configured reflection token
        if let Some(reflection_token) = project.reflection_token {
            require!(extra_mint != reflection_token, ErrorCode::ExtraRewardMintConflict);
        }

        // The vault is the project's own ATA for this mint, derived not created
        let derived_vault = get_associated_token_address_with_program_id(
            &project.key(),
            &extra_mint,
            mint_ai.owner,
        );

        require!(derived_vault != project.staking_vault, ErrorCode::ExtraRewardMintConflict);
        require!(derived_vault != project.reward_vault, ErrorCode::ExtraRewardMintConflict);
        if let Some(reflection_vault) = project.reflection_vault {
            require!(derived_vault != reflection_vault, ErrorCode::ExtraRewardMintConflict);
        }

        let extra = &mut ctx.accounts.extra_reward;
        extra.project = project.key();
        extra.mint = extra_mint;
        extra.vault = derived_vault;
        extra.beneficiary = beneficiary;
        extra.bump = ctx.bumps.extra_reward;

        emit!(ExtraRewardRegistered {
            project: project.key(),
            mint: extra_mint,
            vault: derived_vault,
            beneficiary,
        });

        Ok(())
    }

    pub fn update_extra_reward_beneficiary(
        ctx: Context<UpdateExtraRewardBeneficiary>,
        _token_mint: Pubkey,
        _pool_id: u64,
        _extra_mint: Pubkey,
        new_beneficiary: Pubkey,
    ) -> Result<()> {
        let extra = &mut ctx.accounts.extra_reward;
        let old = extra.beneficiary;
        extra.beneficiary = new_beneficiary;

        emit!(ExtraRewardBeneficiaryUpdated {
            project: extra.project,
            mint: extra.mint,
            old_beneficiary: old,
            new_beneficiary,
        });

        Ok(())
    }

    pub fn claim_extra_reward(
        ctx: Context<ClaimExtraReward>,
        token_mint: Pubkey,
        pool_id: u64,
        _extra_mint: Pubkey,
    ) -> Result<()> {


        let amount = ctx.accounts.extra_vault.amount;
        require!(amount > 0, ErrorCode::NoExtraRewardToClaim);

        let bump = ctx.accounts.project.bump;
        let pool_id_bytes = pool_id.to_le_bytes();
        let seeds = &[
            b"project".as_ref(),
            token_mint.as_ref(),
            pool_id_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let decimals = ctx.accounts.extra_mint_account.decimals;

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.extra_vault.to_account_info(),
                    mint: ctx.accounts.extra_mint_account.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.project.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        emit!(ExtraRewardClaimed {
            project: ctx.accounts.project.key(),
            mint: ctx.accounts.extra_mint_account.key(),
            beneficiary: ctx.accounts.beneficiary.key(),
            amount,
        });

        Ok(())
    }

    pub fn create_project1(
        ctx: Context<CreateProject1>,
        token_mint: Pubkey,
        pool_id: u64,
        reward_token_mint: Pubkey,
    ) -> Result<()> {
        require!(
            token_mint == ctx.accounts.token_mint.key(),
            ErrorCode::MintArgumentMismatch
        );
        require!(
            reward_token_mint == ctx.accounts.reward_token_mint_account.key(),
            ErrorCode::MintArgumentMismatch
        );
        require!(!is_native_sol(&token_mint), ErrorCode::NativeSolUnsupported);
        require!(!is_native_sol(&reward_token_mint), ErrorCode::NativeSolUnsupported);

        // Charge pool creation SOL fee
        let creation_fee = 1_000_000_000u64; // 1 SOL pool creation fee
        if creation_fee > 0 {
            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.admin.key(),
                &ctx.accounts.fee_collector.key(),
                creation_fee,
            );
            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.admin.to_account_info(),
                    ctx.accounts.fee_collector.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        let project = &mut ctx.accounts.project;
        
        project.admin = ctx.accounts.admin.key();
        project.token_mint = token_mint;
        project.pool_id = pool_id;
        project.staking_vault = ctx.accounts.staking_vault.key();
        project.reward_vault = ctx.accounts.reward_vault.key();
        project.reward_token_mint = reward_token_mint;
        project.reward_token_decimals = ctx.accounts.reward_token_mint_account.decimals;
        project.reflection_vault = None;
        project.reflection_token = None;
        
        project.total_staked = 0;
        project.total_rewards_deposited = 0;
        project.total_rewards_claimed = 0;
        
        project.rate_bps_per_year = 0;
        project.rate_mode = 0;
        project.reward_rate_per_second = 0;
        project.lockup_seconds = 0;
        project.pool_duration_seconds = 0;
        project.pool_start_time = 0;
        project.pool_end_time = 0;
        
        project.last_update_time = 0;
        project.reward_per_token_stored = 0;
        project.reflection_per_token_stored = 0;
        project.last_reflection_update_time = 0;
        project.last_reflection_balance = 0;
        
        project.referrer = None;
        project.referrer_split_bps = 0;
        
        project.is_paused = false;
        project.deposit_paused = false;
        project.withdraw_paused = false;
        project.claim_paused = false;
        project.is_initialized = false;
        project.enable_reflections = false;
        
        project.custom_token_fee_bps = 0;
        project.custom_sol_fee = 0;
        project.use_custom_fees = false;
        
        project.bump = ctx.bumps.project;
        project.total_reflection_debt = 0;
        
        // Explicit mint validation
        require!(
            ctx.accounts.token_mint.key() == token_mint,
            ErrorCode::WrongTokenType
        );
        require!(
            ctx.accounts.reward_token_mint_account.key() == reward_token_mint,
            ErrorCode::WrongTokenType
        );
        
        emit!(ProjectCreated {
            project: project.key(),
            token_mint,
            staking_vault: ctx.accounts.staking_vault.key(),
            reward_vault: ctx.accounts.reward_vault.key(),
            admin: ctx.accounts.admin.key(),
        });
        
        Ok(())
    }

    pub fn initialize_pool1(
        ctx: Context<InitializePool1>,
        token_mint: Pubkey,
        pool_id: u64,
        params: InitializePool1Params,
    ) -> Result<()> {
        let project = &mut ctx.accounts.project;
        
        require!(!project.is_initialized, ErrorCode::AlreadyInitialized);
        require!(params.pool_duration_seconds > 0, ErrorCode::InvalidPoolDuration);
        require!(project.token_mint == token_mint, ErrorCode::WrongTokenType);
        require!(project.pool_id == pool_id, ErrorCode::InvalidProject);
        require!(params.rate_bps_per_year <= 1_000_000, ErrorCode::InvalidRateBps);
        require!(params.rate_mode == 0 || params.rate_mode == 1, ErrorCode::InvalidRateMode);

        // Fixed APY derives the payout from staking base units, so the reward
        // token must be the staking token for the decimals to agree.
        if params.rate_mode == 0 {
            require!(
                project.reward_token_mint == project.token_mint,
                ErrorCode::FixedModeRequiresSameMint
            );
        }

        if params.referrer_split_bps.is_some() {
            require!(
                params.referrer_split_bps.unwrap() <= 10000,
                ErrorCode::InvalidReferrerSplit
            );
        }
        
        // Validate custom fees if provided
        if params.use_custom_fees {
            require!(ctx.accounts.admin.key() == ctx.accounts.platform.admin, ErrorCode::Unauthorized);
            require!(params.custom_token_fee_bps <= MAX_PLATFORM_FEE_BPS, ErrorCode::FeeTooHigh);
            require!(params.custom_sol_fee <= MAX_PLATFORM_SOL_FEE, ErrorCode::FeeTooHigh);
        }
        
        let current_time = Clock::get()?.unix_timestamp;
        
        require!(params.lockup_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);
        require!(params.pool_duration_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);

        project.rate_mode = params.rate_mode;
        project.rate_bps_per_year = params.rate_bps_per_year;
        project.lockup_seconds = params.lockup_seconds;
        project.pool_duration_seconds = params.pool_duration_seconds;
        project.pool_start_time = current_time;
        project.pool_end_time = current_time
            .checked_add(params.pool_duration_seconds as i64)
            .ok_or(ErrorCode::MathOverflow)?;
        
        project.last_update_time = current_time;
        project.last_reflection_update_time = current_time;
        
        // Calculate reward rate based on mode
        if params.rate_mode == 0 {
            // Fixed APY: rate is per-token, no division by total_staked in update_reward1
            // reward_rate_per_second = rate_bps / 10000 / seconds_per_year, scaled by 1e9
            let numerator = (params.rate_bps_per_year as u128)
                .checked_mul(1_000_000_000u128)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let denominator = (10_000u128)
                .checked_mul(31_536_000u128)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let rate_per_second = numerator
                .checked_div(denominator)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            require!(rate_per_second <= u64::MAX as u128, ErrorCode::AprTooHigh);
            project.reward_rate_per_second = rate_per_second as u64;
        }
        // Mode 1 (dynamic): reward_rate_per_second set when rewards are deposited
        
        // Set referrer
        if let Some(referrer) = params.referrer {
            project.referrer = Some(referrer);
            project.referrer_split_bps = params.referrer_split_bps.unwrap_or(0);
        }
        
        // Set per-pool fees
        project.custom_token_fee_bps = params.custom_token_fee_bps;
        project.custom_sol_fee = params.custom_sol_fee;
        project.use_custom_fees = params.use_custom_fees;
        
        // Handle reflections
        project.enable_reflections = params.enable_reflections;
        
        if params.enable_reflections {
            require!(
                params.reflection_token.is_some(),
                ErrorCode::ReflectionTokenRequired
            );
            
            let reflection_token = params.reflection_token.unwrap();
            project.reflection_token = Some(reflection_token);
            
            let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
            let is_native_sol = reflection_token == native_sol;
            
            if is_native_sol {
                project.reflection_vault = Some(project.key());
            } else {
                let bump = project.bump;
                let pool_id_bytes = pool_id.to_le_bytes();
                
                let seeds = &[
                    b"project1",
                    token_mint.as_ref(),
                    pool_id_bytes.as_ref(),
                    &[bump],
                ];
                let signer_seeds = &[&seeds[..]];
                
                let reflection_token_account = ctx.accounts.reflection_token_account.as_ref()
                    .ok_or(ErrorCode::ReflectionVaultRequired)?;
                let reflection_token_mint = ctx.accounts.reflection_token_mint.as_ref()
                    .ok_or(ErrorCode::ReflectionTokenRequired)?;
                let reflection_token_program = ctx.accounts.reflection_token_program.as_ref()
                    .ok_or(ErrorCode::ReflectionTokenRequired)?;
                let associated_token_program = ctx.accounts.associated_token_program.as_ref()
                    .ok_or(ErrorCode::MissingAssociatedTokenProgram)?;

                // Fail early on a wrong program or a non mint account rather
                // than relying on the CPI to notice.
                require!(
                    associated_token_program.key() == anchor_spl::associated_token::ID,
                    ErrorCode::MissingAssociatedTokenProgram
                );
                require!(
                    reflection_token_program.key() == anchor_spl::token::ID
                        || reflection_token_program.key() == anchor_spl::token_2022::ID,
                    ErrorCode::ReflectionTokenRequired
                );
                require!(
                    reflection_token_mint.owner == reflection_token_program.key,
                    ErrorCode::ReflectionTokenRequired
                );

                let cpi_accounts = CreateAssociatedToken {
                    payer: ctx.accounts.admin.to_account_info(),
                    associated_token: reflection_token_account.to_account_info(),
                    authority: project.to_account_info(),
                    mint: reflection_token_mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: reflection_token_program.to_account_info(),
                };

                let cpi_ctx = CpiContext::new_with_signer(
                    associated_token_program.to_account_info(),
                    cpi_accounts,
                    signer_seeds,
                );

                create_ata_idempotent(cpi_ctx)?;

                // Idempotent create succeeds when the account already exists,
                // so confirm it really is the project's account for the
                // reflection mint before storing it.
                {
                    let data = reflection_token_account.try_borrow_data()?;
                    require!(data.len() >= 72, ErrorCode::InvalidReflectionVault);
                    let acc_mint = Pubkey::new_from_array(
                        data[0..32].try_into().unwrap()
                    );
                    let acc_owner = Pubkey::new_from_array(
                        data[32..64].try_into().unwrap()
                    );
                    require!(
                        acc_mint == reflection_token_mint.key() && acc_mint == reflection_token,
                        ErrorCode::ReflectionMintMismatch
                    );
                    require!(
                        acc_owner == project.key(),
                        ErrorCode::InvalidReflectionVault
                    );
                }
                
                project.reflection_vault = Some(reflection_token_account.key());
            }
        }
        
        project.is_initialized = true;
        project.total_reflection_debt = 0;
        
        emit!(PoolInitialized {
            project: project.key(),
            staking_vault: project.staking_vault,
            reward_vault: project.reward_vault,
            rate_bps_per_year: params.rate_bps_per_year,
            rate_mode: params.rate_mode,
            lockup_seconds: params.lockup_seconds,
            pool_duration_seconds: params.pool_duration_seconds,
            reflections_enabled: params.enable_reflections,
        });
        
        Ok(())
    }

    pub fn deposit1<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit1<'info>>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        
        require!(
            ctx.accounts.staking_vault.key() == ctx.accounts.project.staking_vault,
            ErrorCode::UnauthorizedVault
        );
        
        // Determine fee rates (per-pool override or platform default)
        let token_fee_bps = if ctx.accounts.project.use_custom_fees {
            ctx.accounts.project.custom_token_fee_bps
        } else {
            ctx.accounts.platform.platform_token_fee_bps
        };
        let sol_fee = if ctx.accounts.project.use_custom_fees {
            ctx.accounts.project.custom_sol_fee
        } else {
            ctx.accounts.platform.platform_sol_fee
        };
        let fee_collector = ctx.accounts.platform.fee_collector;
        
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        require!(!ctx.accounts.project.deposit_paused, ErrorCode::DepositsPaused);
        
        let rent_minimum = 890880u64;
        require!(
            ctx.accounts.user.lamports() >= sol_fee.saturating_add(rent_minimum),
            ErrorCode::InsufficientSolForFee
        );
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < ctx.accounts.project.pool_end_time, ErrorCode::PoolEnded);
        
        let token_fee = ((amount as u128)
            .saturating_mul(token_fee_bps as u128)
            / 10_000u128) as u64;
        
        let amount_after_fee = amount
            .checked_sub(token_fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());
        
        let vault_balance_before = if is_native {
            ctx.accounts.staking_vault.lamports()
        } else {
            let vault_data = ctx.accounts.staking_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        
        transfer_tokens(
            ctx.accounts.user_token_account.to_account_info(),
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.user.to_account_info(),
            &ctx.accounts.token_mint_account,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount_after_fee,
            None,
        )?;
        
        let vault_balance_after = if is_native {
            ctx.accounts.staking_vault.lamports()
        } else {
            let vault_data = ctx.accounts.staking_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        
        let actual_received = vault_balance_after
            .checked_sub(vault_balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let stake = &mut ctx.accounts.stake;
        let is_first_deposit = stake.bump == 0;

        // Settle the global accumulators before the new stake is added, so a
        // first depositor is not credited for time before they arrived and
        // existing stakers keep their full share of that interval.
        if is_first_deposit {
            update_reward1(&mut ctx.accounts.project, stake)?;

            if ctx.accounts.project.enable_reflections {
                let reflection_vault_account = if let Some(ref vault) = ctx.accounts.reflection_vault {
                    Some(vault.to_account_info())
                } else {
                    Some(ctx.accounts.project.to_account_info())
                };
                update_reflection1(&mut ctx.accounts.project, stake, reflection_vault_account.as_ref())?;
            }
        }

        if is_first_deposit {
            stake.user = ctx.accounts.user.key();
            stake.project = ctx.accounts.project.key();
            stake.amount = actual_received;
            stake.last_stake_timestamp = current_time;
            stake.claim_timestamp = current_time;
            stake.withdrawal_wallet = ctx.accounts.user.key();
            stake.reward_per_token_paid = ctx.accounts.project.reward_per_token_stored;
            stake.rewards_pending = 0;
            stake.total_rewards_claimed = 0;
            stake.reflection_per_token_paid = ctx.accounts.project.reflection_per_token_stored;
            stake.reflections_pending = 0;
            stake.total_reflections_claimed = 0;
            stake.reflection_debt = 0;
            stake.bump = ctx.bumps.stake;
            
            let project_mut = &mut ctx.accounts.project;
            project_mut.total_staked = project_mut.total_staked
                .checked_add(actual_received)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            require!(stake.user == ctx.accounts.user.key(), ErrorCode::Unauthorized);
            require!(stake.project == ctx.accounts.project.key(), ErrorCode::InvalidProject);
            
            update_reward1(&mut ctx.accounts.project, stake)?;
            
            if ctx.accounts.project.enable_reflections {
                let reflection_vault_account = if let Some(ref vault) = ctx.accounts.reflection_vault {
                    Some(vault.to_account_info())
                } else {
                    Some(ctx.accounts.project.to_account_info())
                };
                update_reflection1(&mut ctx.accounts.project, stake, reflection_vault_account.as_ref())?;
            }
            
            stake.amount = stake.amount
                .checked_add(actual_received)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let project_mut = &mut ctx.accounts.project;
            project_mut.total_staked = project_mut.total_staked
                .checked_add(actual_received)
                .ok_or(ErrorCode::MathOverflow)?;
            
            stake.last_stake_timestamp = current_time;
        }
        
        // Transfer token fee to fee collector
        if is_native_sol(&ctx.accounts.token_mint_account.key()) {
            require!(
                ctx.accounts.fee_collector_token_account.key() == fee_collector,
                ErrorCode::InvalidFeeCollector
            );
        } else {
            let expected_ata = get_associated_token_address_with_program_id(
                &fee_collector,
                &ctx.accounts.token_mint_account.key(),
                &ctx.accounts.token_program.key(),
            );
            require!(
                ctx.accounts.fee_collector_token_account.key() == expected_ata,
                ErrorCode::InvalidFeeCollector
            );
        }
        if token_fee > 0 {
            transfer_tokens(
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.fee_collector_token_account.to_account_info(),
                ctx.accounts.user.to_account_info(),
                &ctx.accounts.token_mint_account,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                token_fee,
                None,
            )?;
        }
        
        // SOL fee with referral split
        let project_referrer = ctx.accounts.project.referrer;
        let project_referrer_split_bps = ctx.accounts.project.referrer_split_bps;
        
        if sol_fee > 0 {
            if let Some(referrer_key) = project_referrer {
                let referrer_account = if !ctx.remaining_accounts.is_empty() {
                    Some(&ctx.remaining_accounts[0])
                } else {
                    None
                };
                
                if let Some(referrer_account) = referrer_account {
                    require!(
                        referrer_account.key() == referrer_key,
                        ErrorCode::InvalidReferrer
                    );
                    
                    let referrer_amount = sol_fee
                        .checked_mul(project_referrer_split_bps)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    let admin_amount = sol_fee
                        .checked_sub(referrer_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        admin_amount,
                    )?;
                    
                    if referrer_amount > 0 {
                        system_program::transfer(
                            CpiContext::new(
                                ctx.accounts.system_program.to_account_info(),
                                system_program::Transfer {
                                    from: ctx.accounts.user.to_account_info(),
                                    to: referrer_account.to_account_info(),
                                },
                            ),
                            referrer_amount,
                        )?;
                    }
                } else {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        sol_fee,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    sol_fee,
                )?;
            }
        }
        
        emit!(TokensDeposited {
            user: ctx.accounts.user.key(),
            project: ctx.accounts.project.key(),
            amount: actual_received,
            token_fee,
            sol_fee,
            new_total: stake.amount,
        });
        
        Ok(())
    }

    pub fn withdraw1<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw1<'info>>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.stake.amount >= amount, ErrorCode::InsufficientBalance);
        
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        
        // Determine fee rates
        let token_fee_bps = if ctx.accounts.project.use_custom_fees {
            ctx.accounts.project.custom_token_fee_bps
        } else {
            ctx.accounts.platform.platform_token_fee_bps
        };
        let sol_fee = if ctx.accounts.project.use_custom_fees {
            ctx.accounts.project.custom_sol_fee
        } else {
            ctx.accounts.platform.platform_sol_fee
        };
        let fee_collector = ctx.accounts.platform.fee_collector;
        
        let rent_minimum = 890880u64;
        require!(
            ctx.accounts.user.lamports() >= sol_fee.saturating_add(rent_minimum),
            ErrorCode::InsufficientSolForFee
        );
        
        let token_fee = ((amount as u128)
            .saturating_mul(token_fee_bps as u128)
            / 10_000u128) as u64;
        
        let amount_after_fee = amount
            .checked_sub(token_fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(
            ctx.accounts.staking_vault.key() == ctx.accounts.project.staking_vault,
            ErrorCode::UnauthorizedVault
        );
        
        let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());
        let vault_balance = if is_native {
            ctx.accounts.staking_vault.lamports()
        } else {
            let vault_data = ctx.accounts.staking_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        require!(vault_balance >= amount, ErrorCode::InsufficientVaultBalance);
        
        // Update rewards and reflections before changing balances
        update_reward1(&mut ctx.accounts.project, &mut ctx.accounts.stake)?;
        
        if ctx.accounts.project.enable_reflections {
            let reflection_vault_account = if let Some(ref vault) = ctx.accounts.reflection_vault {
                Some(vault.to_account_info())
            } else {
                Some(ctx.accounts.project.to_account_info())
            };
            // Reflection overflow must never block a withdrawal
            match update_reflection1(&mut ctx.accounts.project, &mut ctx.accounts.stake, reflection_vault_account.as_ref()) {
                Ok(()) => {}
                Err(e) if e == error!(ErrorCode::MathOverflow) => {
                    msg!("⚠️ Reflection update skipped during withdraw");
                }
                Err(e) => return Err(e),
            }
        }
        
        // Lockup check using last_stake_timestamp (not claim_timestamp)
        let current_time = Clock::get()?.unix_timestamp;
        let time_staked = current_time
            .checked_sub(ctx.accounts.stake.last_stake_timestamp)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(time_staked >= 0, ErrorCode::InvalidTimestamp);
        
        if time_staked < ctx.accounts.project.lockup_seconds as i64 {
            return Err(ErrorCode::LockupNotExpired.into());
        }
        
        // Validate withdrawal destination
        let dest_owner = if ctx.accounts.withdrawal_token_account.data_len() >= 32 {
            let data = ctx.accounts.withdrawal_token_account.try_borrow_data()?;
            Pubkey::try_from(&data[32..64]).unwrap_or_default()
        } else {
            ctx.accounts.withdrawal_token_account.key()
        };
        require!(
            dest_owner == ctx.accounts.user.key() || dest_owner == ctx.accounts.stake.withdrawal_wallet,
            ErrorCode::InvalidWithdrawalWallet
        );
        
        // Update balances
        ctx.accounts.stake.amount = ctx.accounts.stake.amount
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(
            ctx.accounts.project.total_staked >= amount,
            ErrorCode::InconsistentTotalStaked
        );
        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let seeds = &[
            b"project1",
            ctx.accounts.project.token_mint.as_ref(),
            &ctx.accounts.project.pool_id.to_le_bytes(),
            &[ctx.accounts.project.bump],
        ];
        let signer = &[&seeds[..]];
        
        // Transfer tokens to user
        transfer_tokens(
            ctx.accounts.staking_vault.to_account_info(),
            ctx.accounts.withdrawal_token_account.to_account_info(),
            ctx.accounts.project.to_account_info(),
            &ctx.accounts.token_mint_account,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount_after_fee,
            Some(signer),
        )?;
        
        // Transfer token fee to fee collector
        if is_native_sol(&ctx.accounts.token_mint_account.key()) {
            require!(
                ctx.accounts.fee_collector_token_account.key() == fee_collector,
                ErrorCode::InvalidFeeCollector
            );
        } else {
            let expected_ata = get_associated_token_address_with_program_id(
                &fee_collector,
                &ctx.accounts.token_mint_account.key(),
                &ctx.accounts.token_program.key(),
            );
            require!(
                ctx.accounts.fee_collector_token_account.key() == expected_ata,
                ErrorCode::InvalidFeeCollector
            );
        }
        if token_fee > 0 {
            transfer_tokens(
                ctx.accounts.staking_vault.to_account_info(),
                ctx.accounts.fee_collector_token_account.to_account_info(),
                ctx.accounts.project.to_account_info(),
                &ctx.accounts.token_mint_account,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                token_fee,
                Some(signer),
            )?;
        }
        
        // SOL fee with referral split
        if sol_fee > 0 {
            if let Some(referrer_key) = ctx.accounts.project.referrer {
                let referrer_account = if !ctx.remaining_accounts.is_empty() {
                    Some(&ctx.remaining_accounts[0])
                } else {
                    None
                };
                
                if let Some(referrer_account) = referrer_account {
                    require!(
                        referrer_account.key() == referrer_key,
                        ErrorCode::InvalidReferrer
                    );
                    
                    let referrer_amount = sol_fee
                        .checked_mul(ctx.accounts.project.referrer_split_bps)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    let admin_amount = sol_fee
                        .checked_sub(referrer_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        admin_amount,
                    )?;
                    
                    if referrer_amount > 0 {
                        system_program::transfer(
                            CpiContext::new(
                                ctx.accounts.system_program.to_account_info(),
                                system_program::Transfer {
                                    from: ctx.accounts.user.to_account_info(),
                                    to: referrer_account.to_account_info(),
                                },
                            ),
                            referrer_amount,
                        )?;
                    }
                } else {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        sol_fee,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    sol_fee,
                )?;
            }
        }
        
        emit!(TokensWithdrawn {
            user: ctx.accounts.user.key(),
            project: ctx.accounts.project.key(),
            amount: amount_after_fee,
            remaining: ctx.accounts.stake.amount,
        });
        
        Ok(())
    }

    pub fn claim1<'info>(
        ctx: Context<'_, '_, '_, 'info, Claim1<'info>>,
        token_mint: Pubkey,
        pool_id: u64
    ) -> Result<()> {
        require!(ctx.accounts.stake.rewards_pending > 0 || ctx.accounts.stake.amount > 0, ErrorCode::NoStake);
        
        let sol_fee = if ctx.accounts.project.use_custom_fees {
            ctx.accounts.project.custom_sol_fee
        } else {
            ctx.accounts.platform.platform_sol_fee
        };
        let fee_collector = ctx.accounts.platform.fee_collector;
        
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        require!(
            ctx.accounts.reward_vault.key() == ctx.accounts.project.reward_vault,
            ErrorCode::UnauthorizedVault
        );
        
        let rent_minimum = 890880u64;
        require!(
            ctx.accounts.user.lamports() >= sol_fee.saturating_add(rent_minimum),
            ErrorCode::InsufficientSolForFee
        );
        
        update_reward1(&mut ctx.accounts.project, &mut ctx.accounts.stake)?;
        
        if ctx.accounts.project.enable_reflections && ctx.accounts.project.reflection_token.is_some() {
            if let Some(ref vault) = ctx.accounts.reflection_vault {
                update_reflection1(&mut ctx.accounts.project, &mut ctx.accounts.stake, Some(&vault.to_account_info()))?;
            }
        }
        
        let rewards_u128 = ctx.accounts.stake.rewards_pending;
        require!(rewards_u128 > 0, ErrorCode::NoRewards);
        
        // Safe downcast from u128 to u64 for token transfer
        require!(rewards_u128 <= u64::MAX as u128, ErrorCode::MathOverflow);
        let rewards = rewards_u128 as u64;
        
        // Validate claim destination
        let claim_dest_owner = if ctx.accounts.user_token_account.data_len() >= 32 {
            let data = ctx.accounts.user_token_account.try_borrow_data()?;
            Pubkey::try_from(&data[32..64]).unwrap_or_default()
        } else {
            ctx.accounts.user_token_account.key()
        };
        require!(
            claim_dest_owner == ctx.accounts.user.key() || claim_dest_owner == ctx.accounts.stake.withdrawal_wallet,
            ErrorCode::InvalidWithdrawalWallet
        );
        
        // Check reward vault balance
        let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());
        let vault_balance = if is_native {
            ctx.accounts.reward_vault.lamports()
        } else {
            let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        require!(vault_balance >= rewards, ErrorCode::InsufficientRewardVault);
        
        // Update stake: only claim_timestamp, NOT last_stake_timestamp
        let stake_mut = &mut ctx.accounts.stake;
        stake_mut.rewards_pending = 0;
        stake_mut.claim_timestamp = Clock::get()?.unix_timestamp;
        stake_mut.total_rewards_claimed = stake_mut.total_rewards_claimed
            .checked_add(rewards as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Capture values before mutable borrow
        let project_token_mint = ctx.accounts.project.token_mint;
        let project_pool_id = ctx.accounts.project.pool_id;
        let project_bump = ctx.accounts.project.bump;
        let project_info = ctx.accounts.project.to_account_info();
        
        let project_mut = &mut ctx.accounts.project;
        project_mut.total_rewards_claimed = project_mut.total_rewards_claimed
            .checked_add(rewards as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let seeds = &[
            b"project1",
            project_token_mint.as_ref(),
            &project_pool_id.to_le_bytes(),
            &[project_bump],
        ];
        let signer = &[&seeds[..]];
        
        // Transfer rewards from reward vault
        transfer_tokens(
            ctx.accounts.reward_vault.to_account_info(),
            ctx.accounts.user_token_account.to_account_info(),
            project_info,
            &ctx.accounts.token_mint_account,
            ctx.accounts.reward_token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            rewards,
            Some(signer),
        )?;
        
        // SOL fee with referral split
        if sol_fee > 0 {
            if let Some(referrer_key) = ctx.accounts.project.referrer {
                let referrer_account = if !ctx.remaining_accounts.is_empty() {
                    Some(&ctx.remaining_accounts[0])
                } else {
                    None
                };
                
                if let Some(referrer_account) = referrer_account {
                    require!(
                        referrer_account.key() == referrer_key,
                        ErrorCode::InvalidReferrer
                    );
                    
                    let referrer_amount = sol_fee
                        .checked_mul(ctx.accounts.project.referrer_split_bps)
                        .ok_or(ErrorCode::MathOverflow)?
                        .checked_div(10000)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    let admin_amount = sol_fee
                        .checked_sub(referrer_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                    
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        admin_amount,
                    )?;
                    
                    if referrer_amount > 0 {
                        system_program::transfer(
                            CpiContext::new(
                                ctx.accounts.system_program.to_account_info(),
                                system_program::Transfer {
                                    from: ctx.accounts.user.to_account_info(),
                                    to: referrer_account.to_account_info(),
                                },
                            ),
                            referrer_amount,
                        )?;
                    }
                } else {
                    system_program::transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.to_account_info(),
                            system_program::Transfer {
                                from: ctx.accounts.user.to_account_info(),
                                to: ctx.accounts.fee_collector.to_account_info(),
                            },
                        ),
                        sol_fee,
                    )?;
                }
            } else {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
                            to: ctx.accounts.fee_collector.to_account_info(),
                        },
                    ),
                    sol_fee,
                )?;
            }
        }
        
        emit!(RewardsClaimed {
            user: ctx.accounts.user.key(),
            project: ctx.accounts.project.key(),
            amount: rewards,
        });
        
        Ok(())
    }

    pub fn deposit_rewards1(
        ctx: Context<DepositRewards1>,
        token_mint: Pubkey,
        pool_id: u64,
        amount: u64
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        require!(
            ctx.accounts.reward_vault.key() == ctx.accounts.project.reward_vault,
            ErrorCode::UnauthorizedVault
        );
        
        let is_native = is_native_sol(&ctx.accounts.token_mint_account.key());
        
        let vault_balance_before = if is_native {
            ctx.accounts.reward_vault.lamports()
        } else {
            let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        
        transfer_tokens(
            ctx.accounts.admin_token_account.to_account_info(),
            ctx.accounts.reward_vault.to_account_info(),
            ctx.accounts.admin.to_account_info(),
            &ctx.accounts.token_mint_account,
            ctx.accounts.reward_token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount,
            None,
        )?;
        
        let vault_balance_after = if is_native {
            ctx.accounts.reward_vault.lamports()
        } else {
            let vault_data = ctx.accounts.reward_vault.try_borrow_data()?;
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        };
        
        let actual_received = vault_balance_after
            .checked_sub(vault_balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let project_key = ctx.accounts.project.key();
        
        // Settle the accumulator before any rate change so the new rate is
        // never applied to the preceding interval
        settle_global_reward1(&mut ctx.accounts.project)?;

        let project_mut = &mut ctx.accounts.project;
        project_mut.total_rewards_deposited = project_mut.total_rewards_deposited
            .checked_add(actual_received)
            .ok_or(ErrorCode::MathOverflow)?;
        
        match project_mut.rate_mode {
            0 => {
                // Fixed APY: rate already set in initialize_pool1
            }
            
            1 => {
                let current_time = Clock::get()?.unix_timestamp;
                let time_remaining = project_mut.pool_end_time
                    .checked_sub(current_time)
                    .unwrap_or(0);

                // A top-up after the pool has ended would strand the tokens
                require!(time_remaining > 0, ErrorCode::PoolEnded);

                // Add only the newly deposited amount to the existing rate.
                // Recomputing from deposited minus claimed would promise
                // accrued but unclaimed rewards a second time.
                let rate_increment = actual_received
                    .checked_div(time_remaining as u64)
                    .unwrap_or(0);

                // A deposit too small to move the rate would never be emitted.
                require!(rate_increment > 0, ErrorCode::ZeroRateIncrement);

                project_mut.reward_rate_per_second = project_mut.reward_rate_per_second
                    .checked_add(rate_increment)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
            
            _ => return Err(ErrorCode::InvalidRateMode.into()),
        }
        
        emit!(RewardsDeposited {
            project: project_key,
            amount: actual_received,
            total_rewards: project_mut.total_rewards_deposited,
            reward_rate: project_mut.reward_rate_per_second,
        });
        
        Ok(())
    }

    pub fn refresh_reflections1(
        ctx: Context<RefreshReflections1>,
        _token_mint: Pubkey,
        _pool_id: u64,
    ) -> Result<()> {
        require!(ctx.accounts.stake.amount > 0, ErrorCode::NoStake);
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);
        require!(ctx.accounts.project.enable_reflections, ErrorCode::ReflectionsNotEnabled);
        require!(
            ctx.accounts.project.reflection_token.is_some(),
            ErrorCode::ReflectionTokenRequired
        );
        
        update_reflection1(
            &mut ctx.accounts.project,
            &mut ctx.accounts.stake,
            Some(&ctx.accounts.reflection_vault.to_account_info()),
        )?;
        
        Ok(())
    }

    pub fn claim_reflections1(
        ctx: Context<ClaimReflections1>,
        _token_mint: Pubkey,
        _pool_id: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.project.reflection_vault == Some(ctx.accounts.reflection_vault.key()),
            ErrorCode::InvalidReflectionVault
        );
        
        require!(ctx.accounts.project.is_initialized, ErrorCode::NotInitialized);

        require!(ctx.accounts.project.enable_reflections, ErrorCode::ReflectionsNotEnabled);
        require!(
            ctx.accounts.project.reflection_token.is_some(),
            ErrorCode::ReflectionTokenRequired
        );
        
        let reflection_token_mint = ctx.accounts.project.reflection_token.unwrap();
        let amount = ctx.accounts.stake.reflections_pending;
        
        require!(amount > 0, ErrorCode::NoReflectionsToClaim);
        
        // Validate reflection destination belongs to user
        let reflect_dest_data = ctx.accounts.user_reflection_account.try_borrow_data()?;
        if reflect_dest_data.len() >= 64 {
            let reflect_dest_owner = Pubkey::try_from(&reflect_dest_data[32..64]).unwrap_or_default();
            drop(reflect_dest_data);
            require!(
                reflect_dest_owner == ctx.accounts.user.key() || reflect_dest_owner == ctx.accounts.stake.withdrawal_wallet,
                ErrorCode::InvalidWithdrawalWallet
            );
        } else {
            drop(reflect_dest_data);
            // Native SOL path: account key must be user's wallet
            require!(
                ctx.accounts.user_reflection_account.key() == ctx.accounts.user.key(),
                ErrorCode::InvalidWithdrawalWallet
            );
        }
        
        let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let is_native_sol = reflection_token_mint == native_sol;
        
        let decimals = if !is_native_sol {
            require!(
                ctx.accounts.reflection_token_mint.key() == reflection_token_mint,
                ErrorCode::ReflectionMintMismatch
            );
            ctx.accounts.reflection_token_mint.decimals
        } else {
            9
        };
        
        // Apply 99.7% buffer for Native SOL to prevent rent issues
        let amount_to_transfer = if is_native_sol {
            amount.saturating_mul(997).saturating_div(1000)
        } else {
            amount
        };
        
        let seeds = &[
            b"project1",
            ctx.accounts.project.token_mint.as_ref(),
            &ctx.accounts.project.pool_id.to_le_bytes(),
            &[ctx.accounts.project.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        if is_native_sol {
            **ctx.accounts.reflection_vault.try_borrow_mut_lamports()? -= amount_to_transfer;
            **ctx.accounts.user_reflection_account.try_borrow_mut_lamports()? += amount_to_transfer;
        } else {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.reflection_vault.to_account_info(),
                        to: ctx.accounts.user_reflection_account.to_account_info(),
                        authority: ctx.accounts.project.to_account_info(),
                        mint: ctx.accounts.reflection_token_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount_to_transfer,
                decimals,
            )?;
        }
        
        let stake_mut = &mut ctx.accounts.stake;
        stake_mut.reflections_pending = 0;
        stake_mut.total_reflections_claimed = stake_mut.total_reflections_claimed
            .checked_add(amount_to_transfer)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Update vault balance tracking
        let current_vault_balance = if is_native_sol {
            let total_lamports = ctx.accounts.reflection_vault.lamports();
            let rent = Rent::get()?;
            let rent_exempt_minimum = rent.minimum_balance(ctx.accounts.reflection_vault.data_len());
            let fixed_buffer = rent_exempt_minimum.saturating_add(3_000_000);
            total_lamports.saturating_sub(fixed_buffer)
        } else {
            let vault_data = ctx.accounts.reflection_vault.try_borrow_data()?;
            if vault_data.len() >= 72 {
                u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
            } else {
                0
            }
        };
        
        let project_mut = &mut ctx.accounts.project;
        project_mut.last_reflection_balance = project_mut
            .last_reflection_balance
            .saturating_sub(amount_to_transfer);
        
        emit!(ReflectionsClaimed {
            user: ctx.accounts.user.key(),
            project: ctx.accounts.project.key(),
            amount: amount_to_transfer,
        });
        
        Ok(())
    }

    pub fn create_vesting(
        ctx: Context<CreateVesting>,
        beneficiary: Pubkey,
        schedule_id: u64,
        amount: u64,
        cliff_seconds: u64,
        total_duration_seconds: u64,
        revocable: bool,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(total_duration_seconds > 0, ErrorCode::InvalidPoolDuration);
        require!(total_duration_seconds <= MAX_LOCKUP_SECONDS, ErrorCode::LockupTooLong);
        require!(cliff_seconds <= total_duration_seconds, ErrorCode::InvalidAmount);
        
        // Native SOL not supported for vesting
        require!(!is_native_sol(&ctx.accounts.token_mint.key()), ErrorCode::WrongTokenType);
        
        // Validate creator token account owner
        let creator_acct_data = ctx.accounts.creator_token_account.try_borrow_data()?;
        require!(creator_acct_data.len() >= 64, ErrorCode::InvalidWithdrawalWallet);
        let creator_acct_owner = Pubkey::try_from(&creator_acct_data[32..64]).unwrap_or_default();
        drop(creator_acct_data);
        require!(creator_acct_owner == ctx.accounts.creator.key(), ErrorCode::InvalidWithdrawalWallet);

        // Validate fee collector token account
        let expected_fee_ata = get_associated_token_address_with_program_id(
            &ctx.accounts.platform.fee_collector,
            &ctx.accounts.token_mint.key(),
            &ctx.accounts.token_program.key(),
        );
        require!(
            ctx.accounts.fee_collector_token_account.key() == expected_fee_ata,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate token fee
        let platform_token_fee_bps = ctx.accounts.platform.platform_token_fee_bps;
        let token_fee = ((amount as u128)
            .saturating_mul(platform_token_fee_bps as u128)
            / 10_000u128) as u64;
        let amount_after_fee = amount
            .checked_sub(token_fee)
            .ok_or(ErrorCode::MathOverflow)?;

        // Charge SOL fee
        let platform_sol_fee = ctx.accounts.platform.platform_sol_fee;
        if platform_sol_fee > 0 {
            let ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.creator.key(),
                &ctx.accounts.fee_collector.key(),
                platform_sol_fee,
            );
            anchor_lang::solana_program::program::invoke(
                &ix,
                &[
                    ctx.accounts.creator.to_account_info(),
                    ctx.accounts.fee_collector.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }
        
        let current_time = Clock::get()?.unix_timestamp;
        
        let vault_balance_before = ctx.accounts.vesting_vault.amount;
        
        // Transfer tokens minus fee to vault
        transfer_tokens(
            ctx.accounts.creator_token_account.to_account_info(),
            ctx.accounts.vesting_vault.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            &ctx.accounts.token_mint,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount_after_fee,
            None,
        )?;

        // Transfer token fee to fee collector
        if token_fee > 0 {
            transfer_tokens(
                ctx.accounts.creator_token_account.to_account_info(),
                ctx.accounts.fee_collector_token_account.to_account_info(),
                ctx.accounts.creator.to_account_info(),
                &ctx.accounts.token_mint,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                token_fee,
                None,
            )?;
        }
        
        ctx.accounts.vesting_vault.reload()?;
        let vault_balance_after = ctx.accounts.vesting_vault.amount;
        
        let actual_received = vault_balance_after
            .checked_sub(vault_balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let schedule = &mut ctx.accounts.vesting_schedule;
        schedule.creator = ctx.accounts.creator.key();
        schedule.beneficiary = beneficiary;
        schedule.schedule_id = schedule_id;
        schedule.token_mint = ctx.accounts.token_mint.key();
        schedule.vault = ctx.accounts.vesting_vault.key();
        schedule.total_amount = actual_received;
        schedule.released_amount = 0;
        schedule.start_time = current_time;
        schedule.cliff_seconds = cliff_seconds;
        schedule.total_duration_seconds = total_duration_seconds;
        schedule.revocable = revocable;
        schedule.revoked = false;
        schedule.bump = ctx.bumps.vesting_schedule;
        
        emit!(VestingCreated {
            creator: ctx.accounts.creator.key(),
            beneficiary,
            schedule_id,
            token_mint: ctx.accounts.token_mint.key(),
            amount: actual_received,
            cliff_seconds,
            total_duration_seconds,
            revocable,
        });
        
        Ok(())
    }

    pub fn claim_vested(
        ctx: Context<ClaimVested>,
        _schedule_id: u64,
    ) -> Result<()> {
        let schedule = &ctx.accounts.vesting_schedule;
        
        require!(!schedule.revoked, ErrorCode::ProjectPaused);
        require!(schedule.beneficiary == ctx.accounts.beneficiary.key(), ErrorCode::Unauthorized);
        
        let current_time = Clock::get()?.unix_timestamp;
        
        // Check cliff
        let cliff_end = schedule.start_time
            .checked_add(schedule.cliff_seconds as i64)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(current_time >= cliff_end, ErrorCode::CliffNotEnded);
        
                // Validate destination belongs to beneficiary
        let dest_data = ctx.accounts.beneficiary_token_account.try_borrow_data()?;
        require!(dest_data.len() >= 64, ErrorCode::InvalidWithdrawalWallet);
        let dest_owner = Pubkey::try_from(&dest_data[32..64]).unwrap_or_default();
        drop(dest_data);
        require!(dest_owner == ctx.accounts.beneficiary.key(), ErrorCode::InvalidWithdrawalWallet);

        // Calculate vested amount
        let vesting_end = schedule.start_time
            .checked_add(schedule.total_duration_seconds as i64)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let vested_amount = if current_time >= vesting_end {
            schedule.total_amount
        } else {
            let elapsed = (current_time - schedule.start_time) as u128;
            let total = schedule.total_duration_seconds as u128;
            let amount = schedule.total_amount as u128;
            
            let vested = amount
                .checked_mul(elapsed)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            require!(vested <= u64::MAX as u128, ErrorCode::MathOverflow);
            vested as u64
        };
        
        let claimable = vested_amount
            .checked_sub(schedule.released_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(claimable > 0, ErrorCode::NoRewards);
        
        // Transfer from vault to beneficiary
        let schedule_id_bytes = schedule.schedule_id.to_le_bytes();
        let seeds = &[
            b"vesting".as_ref(),
            schedule.creator.as_ref(),
            schedule.beneficiary.as_ref(),
            schedule.token_mint.as_ref(),
            schedule_id_bytes.as_ref(),
            &[schedule.bump],
        ];
        let signer = &[&seeds[..]];
        
        transfer_tokens(
            ctx.accounts.vesting_vault.to_account_info(),
            ctx.accounts.beneficiary_token_account.to_account_info(),
            ctx.accounts.vesting_schedule.to_account_info(),
            &ctx.accounts.token_mint,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            claimable,
            Some(signer),
        )?;
        
        let schedule_mut = &mut ctx.accounts.vesting_schedule;
        schedule_mut.released_amount = schedule_mut.released_amount
            .checked_add(claimable)
            .ok_or(ErrorCode::MathOverflow)?;
        
        emit!(VestingClaimed {
            beneficiary: ctx.accounts.beneficiary.key(),
            amount: claimable,
            total_released: schedule_mut.released_amount,
        });
        
        Ok(())
    }

    pub fn revoke_vesting(
        ctx: Context<RevokeVesting>,
        _schedule_id: u64,
    ) -> Result<()> {
        let schedule = &ctx.accounts.vesting_schedule;
        
        require!(schedule.revocable, ErrorCode::Unauthorized);
        require!(!schedule.revoked, ErrorCode::ProjectPaused);
        require!(schedule.creator == ctx.accounts.creator.key(), ErrorCode::Unauthorized);
        
        let current_time = Clock::get()?.unix_timestamp;
        
        // Calculate vested amount at time of revocation
        let vesting_end = schedule.start_time
            .checked_add(schedule.total_duration_seconds as i64)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let vested_amount = if current_time >= vesting_end {
            schedule.total_amount
        } else {
            let cliff_end = schedule.start_time
                .checked_add(schedule.cliff_seconds as i64)
                .ok_or(ErrorCode::MathOverflow)?;
            
            if current_time < cliff_end {
                0
            } else {
                let elapsed = (current_time - schedule.start_time) as u128;
                let total = schedule.total_duration_seconds as u128;
                let amount = schedule.total_amount as u128;
                
                let vested = amount
                    .checked_mul(elapsed)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(total)
                    .ok_or(ErrorCode::DivisionByZero)?;
                
                require!(vested <= u64::MAX as u128, ErrorCode::MathOverflow);
                vested as u64
            }
        };
        
        // Unvested amount goes back to creator
        let unvested = schedule.total_amount
            .checked_sub(vested_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Any vested but unclaimed goes to beneficiary
        let unclaimed_vested = vested_amount
            .checked_sub(schedule.released_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Validate creator token account owner
        let creator_data = ctx.accounts.creator_token_account.try_borrow_data()?;
        require!(creator_data.len() >= 64, ErrorCode::InvalidWithdrawalWallet);
        let creator_owner = Pubkey::try_from(&creator_data[32..64]).unwrap_or_default();
        drop(creator_data);
        require!(creator_owner == ctx.accounts.creator.key(), ErrorCode::InvalidWithdrawalWallet);
        
        // Validate beneficiary token account owner
        let ben_data = ctx.accounts.beneficiary_token_account.try_borrow_data()?;
        require!(ben_data.len() >= 64, ErrorCode::InvalidWithdrawalWallet);
        let ben_owner = Pubkey::try_from(&ben_data[32..64]).unwrap_or_default();
        drop(ben_data);
        require!(ben_owner == schedule.beneficiary, ErrorCode::InvalidWithdrawalWallet);
        
        let schedule_id_bytes = schedule.schedule_id.to_le_bytes();
        let seeds = &[
            b"vesting".as_ref(),
            schedule.creator.as_ref(),
            schedule.beneficiary.as_ref(),
            schedule.token_mint.as_ref(),
            schedule_id_bytes.as_ref(),
            &[schedule.bump],
        ];
        let signer = &[&seeds[..]];
        
        // Return unvested to creator
        if unvested > 0 {
            transfer_tokens(
                ctx.accounts.vesting_vault.to_account_info(),
                ctx.accounts.creator_token_account.to_account_info(),
                ctx.accounts.vesting_schedule.to_account_info(),
                &ctx.accounts.token_mint,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                unvested,
                Some(signer),
            )?;
        }
        
        // Send unclaimed vested to beneficiary
        if unclaimed_vested > 0 {
            transfer_tokens(
                ctx.accounts.vesting_vault.to_account_info(),
                ctx.accounts.beneficiary_token_account.to_account_info(),
                ctx.accounts.vesting_schedule.to_account_info(),
                &ctx.accounts.token_mint,
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                unclaimed_vested,
                Some(signer),
            )?;
        }
        
        let schedule_beneficiary = ctx.accounts.vesting_schedule.beneficiary;
        let creator_key = ctx.accounts.creator.key();
        
        let schedule_mut = &mut ctx.accounts.vesting_schedule;
        schedule_mut.revoked = true;
        schedule_mut.released_amount = vested_amount;
        
        emit!(VestingRevoked {
            creator: creator_key,
            beneficiary: schedule_beneficiary,
            unvested_returned: unvested,
            vested_sent_to_beneficiary: unclaimed_vested,
        });
        
        Ok(())
    }
}

// Advances the global accumulator only, with no stake account. Called before
// a rate change so the new rate is never applied to the preceding interval.
fn settle_global_reward1(project: &mut Account<Project1>) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;

    // Cap effective time at pool end
    let effective_now = if current_time > project.pool_end_time {
        project.pool_end_time
    } else {
        current_time
    };

    if project.total_staked > 0 && effective_now > project.last_update_time {
        let time_delta = effective_now
            .checked_sub(project.last_update_time)
            .unwrap_or(0)
            .max(0) as u128;

        if time_delta > 0 {
            let reward_per_token_increment = if project.rate_mode == 0 {
                // Fixed APY: rate is per-token, no division by total_staked.
                // Computed from the configured bps for the same reason as V1.
                (project.rate_bps_per_year as u128)
                    .saturating_mul(time_delta)
                    .saturating_mul(1_000_000_000_000_000_000u128)
                    / (10_000u128 * 31_536_000u128)
            } else {
                // Dynamic: rate is total pool emission, divide by total_staked
                (project.reward_rate_per_second as u128)
                    .checked_mul(time_delta)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_mul(1_000_000_000_000_000_000u128)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(project.total_staked as u128)
                    .ok_or(ErrorCode::DivisionByZero)?
            };

            project.reward_per_token_stored = project.reward_per_token_stored
                .checked_add(reward_per_token_increment)
                .ok_or(ErrorCode::MathOverflow)?;
        }
    }

    project.last_update_time = effective_now;

    Ok(())
}

fn update_reward1(project: &mut Account<Project1>, stake: &mut Account<Stake1>) -> Result<()> {
    settle_global_reward1(project)?;
    
    // Update user rewards using accumulator diff
    if stake.amount > 0 {
        let reward_diff = project.reward_per_token_stored
            .checked_sub(stake.reward_per_token_paid)
            .ok_or(ErrorCode::MathOverflow)?;
        
        let earned = (reward_diff)
            .saturating_mul(stake.amount as u128)
            / 1_000_000_000_000_000_000u128;
        
        stake.rewards_pending = stake.rewards_pending
            .saturating_add(earned);
    }
    
    stake.reward_per_token_paid = project.reward_per_token_stored;
    
    Ok(())
}

fn update_reflection1(
    project: &mut Account<Project1>,
    stake: &mut Account<Stake1>,
    reflection_vault: Option<&AccountInfo>,
) -> Result<()> {
    if !project.enable_reflections {
        return Ok(());
    }
    
    if project.reflection_token.is_none() {
        return Ok(());
    }
    
    let vault = reflection_vault.ok_or(ErrorCode::ReflectionVaultRequired)?;
    if let Some(expected) = project.reflection_vault {
        require!(vault.key() == expected, ErrorCode::InvalidReflectionVault);
    }
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Cap at pool end time
    let effective_now = if current_time > project.pool_end_time {
        project.pool_end_time
    } else {
        current_time
    };
    
    let reflection_token_mint = project.reflection_token.unwrap();
    let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
    let is_native_sol = reflection_token_mint == native_sol;
    
    let current_balance = if is_native_sol {
        let total_lamports = vault.lamports();
        let rent = Rent::get()?;
        let rent_exempt_minimum = rent.minimum_balance(vault.data_len());
        let fixed_buffer = rent_exempt_minimum.saturating_add(3_000_000);
        total_lamports.saturating_sub(fixed_buffer)
    } else {
        let vault_data = vault.try_borrow_data()?;
        if vault_data.len() >= 72 {
            u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
        } else {
            0
        }
    };
    
    if project.total_staked > 0 && current_balance > project.last_reflection_balance {
        let new_reflections = current_balance
            .checked_sub(project.last_reflection_balance)
            .unwrap_or(0);
        
        if new_reflections > 0 {
            let per_token = (new_reflections as u128)
                .checked_mul(1_000_000_000u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(project.total_staked as u128)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            let per_token = if per_token > u64::MAX as u128 {
                u64::MAX as u128
            } else {
                per_token
            };
            
            let stored_before = project.reflection_per_token_stored;
            project.reflection_per_token_stored = stored_before
                .saturating_add(per_token as u64);
            let applied_rate = project.reflection_per_token_stored
                .saturating_sub(stored_before) as u128;

            // Advance the baseline only by what was actually distributed, so
            // the rounding remainder stays in the pool for the next update.
            let distributed_u128 = applied_rate
                .saturating_mul(project.total_staked as u128)
                / 1_000_000_000u128;
            let distributed = if distributed_u128 > new_reflections as u128 {
                new_reflections
            } else {
                distributed_u128 as u64
            };
            project.last_reflection_balance = project
                .last_reflection_balance
                .saturating_add(distributed);
        }
    }
    
    // Only ever lower the baseline here. A decrease means reflections left the
    // vault, so the marker follows it down. Increases are handled above, by the
    // amount actually distributed, which keeps reflections that arrive while
    // nothing is staked available for the next update.
    if current_balance < project.last_reflection_balance {
        project.last_reflection_balance = current_balance;
    }
    project.last_reflection_update_time = effective_now;
    
    if stake.amount > 0 {
        let reward_diff = project.reflection_per_token_stored
            .checked_sub(stake.reflection_per_token_paid)
            .unwrap_or(0);
        
        if reward_diff > 0 {
            let earned = (reward_diff as u128)
                .checked_mul(stake.amount as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(1_000_000_000u128)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            require!(earned <= u64::MAX as u128, ErrorCode::MathOverflow);
            
            stake.reflections_pending = stake.reflections_pending
                .checked_add(earned as u64)
                .ok_or(ErrorCode::MathOverflow)?;
        }
    }
    
    stake.reflection_per_token_paid = project.reflection_per_token_stored;
    
    Ok(())
}

fn update_reward(project: &mut Account<Project>, stake: &mut Account<Stake>) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    
    // Update project's reward tracking (kept for compatibility)
    if project.total_staked > 0 && current_time > project.last_update_time {
        let time_delta_i64 = current_time
            .checked_sub(project.last_update_time)
            .ok_or(ErrorCode::MathOverflow)?;
        
        require!(time_delta_i64 >= 0, ErrorCode::InvalidTimestamp);
        let time_delta = time_delta_i64 as u64;
        
        let effective_time = if current_time > project.pool_end_time {
            let time_until_end = project.pool_end_time
                .checked_sub(project.last_update_time)
                .unwrap_or(0)
                .max(0);
            
            require!(time_until_end >= 0, ErrorCode::InvalidTimestamp);
            time_until_end as u64
        } else {
            time_delta
        };
        
        if effective_time > 0 {
            let intermediate = (project.reward_rate_per_second as u128)
                .checked_mul(effective_time as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            
            let result_u128 = intermediate
                .checked_div(project.total_staked as u128)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            let rewards_per_token = if result_u128 > u64::MAX as u128 {
                u64::MAX
            } else {
                result_u128 as u64
            };
            
            project.reward_per_token_stored = project.reward_per_token_stored
                .saturating_add(rewards_per_token);
        }
    }
    
    project.last_update_time = current_time;
    
    // Calculate rewards for this specific stake
    if stake.amount > 0 && project.total_staked > 0 {
        // reflection_debt is repurposed as a reward accrual timestamp.
        // It is 0 on every account created before this upgrade, so 0 means
        // "not set" and we fall back to last_stake_timestamp.
        let accrual_start = if stake.reflection_debt > 0 {
            (stake.reflection_debt as i64).max(stake.last_stake_timestamp)
        } else {
            stake.last_stake_timestamp
        };
        let stake_last_update = accrual_start;
        let time_since_stake_update = current_time
            .checked_sub(stake_last_update)
            .unwrap_or(0)
            .max(0);
        
        require!(time_since_stake_update >= 0, ErrorCode::InvalidTimestamp);
        
        // Adjust for pool end time
        let effective_time = if current_time > project.pool_end_time {
            if stake_last_update >= project.pool_end_time {
                0
            } else {
                (project.pool_end_time - stake_last_update).max(0) as u64
            }
        } else {
            time_since_stake_update as u64
        };
        
        if effective_time > 0 {
            let intermediate = (project.reward_rate_per_second as u128)
                .saturating_mul(effective_time as u128)
                .saturating_mul(stake.amount as u128);
            
            // ✅ Check rate_mode to use correct formula
            let new_rewards_u128 = if project.rate_mode == 0 {
                // Fixed APY: reward_rate_per_second has 1e9 scaling
                // Formula: (amount × rate × time) / 1e9
                // Computed from the configured bps, not the stored per second
                // rate, which truncates to zero below 316 bps.
                (stake.amount as u128)
                    .saturating_mul(project.rate_bps_per_year as u128)
                    .saturating_mul(effective_time as u128)
                    / (10_000u128 * 31_536_000u128)
            } else {
                // Dynamic pool: reward_rate_per_second is lamports/sec for entire pool
                // Formula: (amount × rate × time) / totalStaked
                intermediate
                    .checked_div(project.total_staked as u128)
                    .ok_or(ErrorCode::DivisionByZero)?
            };
            
            // An unpayable figure is dropped rather than pinned at u64::MAX,
            // which would block that stake's claim permanently.
            let new_rewards = if new_rewards_u128 > u64::MAX as u128 {
                0
            } else {
                new_rewards_u128 as u64
            };
            
            stake.rewards_pending = stake.rewards_pending
                .checked_add(new_rewards).unwrap_or(stake.rewards_pending);
        }
    }
    
    Ok(())
}

fn update_reflection_internal(
    project: &mut Account<Project>,
    stake: &mut Account<Stake>,
    reflection_vault: Option<&AccountInfo>,
    update_user_paid_marker: bool,
) -> Result<()> {
    if !project.enable_reflections {
        return Ok(());
    }
    
    if project.reflection_token.is_none() {
        return Ok(());
    }
    
    let vault = reflection_vault.ok_or(ErrorCode::ReflectionVaultRequired)?;
    if let Some(expected) = project.reflection_vault {
        require!(vault.key() == expected, ErrorCode::InvalidReflectionVault);
    }
    let current_time = Clock::get()?.unix_timestamp;
    
    // Determine reflection type
    let reflection_token_mint = project.reflection_token.unwrap();
    let native_sol = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
    let is_native_sol = reflection_token_mint == native_sol;
    
    // ✅ Calculate distributable balance based on reflection type
    let current_balance = if is_native_sol {
        // ✅ Native SOL - read from Project PDA lamports with 0.003 SOL buffer
        let total_lamports = vault.lamports();
        let rent = Rent::get()?;
        let rent_exempt_minimum = rent.minimum_balance(vault.data_len());
        // Reserve rent plus a 0.003 SOL buffer so the PDA stays funded
        let fixed_buffer = rent_exempt_minimum.saturating_add(3_000_000);

        total_lamports.saturating_sub(fixed_buffer)
    } else {
        // ✅ SPL/Token-2022 - read from Project PDA's standard ATA
        // (Works for both self-reflection and external reflection)
        let vault_data = vault.try_borrow_data()?;
        if vault_data.len() < 72 {
            return Err(ErrorCode::InvalidReflectionVault.into());
        }
        u64::from_le_bytes(vault_data[64..72].try_into().unwrap())
    };
    
    let calc_current_balance = current_balance;
    let calc_last_balance = project.last_reflection_balance;
    let calc_new_tokens = current_balance.saturating_sub(project.last_reflection_balance);
    let calc_total_staked = project.total_staked;

    // If balance decreased (e.g., admin withdrew reflections), reset baseline
    if calc_current_balance < calc_last_balance {
        project.last_reflection_balance = calc_current_balance;
        project.last_reflection_update_time = current_time;
        return Ok(());
    }
    
    // Calculate and distribute new reflections
    if calc_new_tokens > 0 && calc_total_staked > 0 {
        let per_token_u128 = (calc_new_tokens as u128)
            .checked_mul(1_000_000_000u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(calc_total_staked as u128)
            .ok_or(ErrorCode::DivisionByZero)?;
        
        let per_token_rate = if per_token_u128 > u64::MAX as u128 {
            u64::MAX
        } else {
            per_token_u128 as u64
        };
        
        let stored_before = project.reflection_per_token_stored;
        project.reflection_per_token_stored = stored_before
            .saturating_add(per_token_rate);
        let applied_rate = project.reflection_per_token_stored
            .saturating_sub(stored_before);
        
        // Advance the baseline only by what was actually distributed, so the
        // rounding remainder stays in the pool for the next update.
        let distributed_u128 = (applied_rate as u128)
            .saturating_mul(calc_total_staked as u128)
            / 1_000_000_000u128;
        let distributed = if distributed_u128 > calc_new_tokens as u128 {
            calc_new_tokens
        } else {
            distributed_u128 as u64
        };
        project.last_reflection_balance = project
            .last_reflection_balance
            .saturating_add(distributed);
        project.last_reflection_update_time = current_time;
    }
    
    // Update user's pending reflections
    if stake.amount > 0 {
        let rate_diff = project.reflection_per_token_stored
            .saturating_sub(stake.reflection_per_token_paid);
        
        if rate_diff > 0 {
            let earned_u128 = (rate_diff as u128)
                .checked_mul(stake.amount as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(1_000_000_000u128)
                .ok_or(ErrorCode::DivisionByZero)?;
            
            require!(earned_u128 <= u64::MAX as u128, ErrorCode::MathOverflow);
            let earned = earned_u128 as u64;
            
            // reflection_debt is now a reward accrual timestamp, not a debt.
            // It was always 0 here before, so subtracting it and resetting it
            // were both no-ops.
            let net_earned = earned;

            stake.reflections_pending = stake.reflections_pending
                .checked_add(net_earned)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
    }

    if update_user_paid_marker {
        stake.reflection_per_token_paid = project.reflection_per_token_stored;
    }
    
    Ok(())
}

fn update_reflection(
    project: &mut Account<Project>,
    stake: &mut Account<Stake>,
    reflection_vault: Option<&AccountInfo>,
) -> Result<()> {
    update_reflection_internal(project, stake, reflection_vault, true)
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Platform::INIT_SPACE,
        seeds = [b"platform_v2"],
        bump
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    /// CHECK: Fee collector wallet
    pub fee_collector: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(beneficiary: Pubkey, schedule_id: u64, amount: u64, cliff_seconds: u64, total_duration_seconds: u64, revocable: bool)]
pub struct CreateVesting<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        init,
        payer = creator,
        space = 8 + VestingSchedule::INIT_SPACE,
        seeds = [b"vesting", creator.key().as_ref(), beneficiary.as_ref(), token_mint.key().as_ref(), &schedule_id.to_le_bytes()],
        bump
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,
    
    #[account(
        init,
        payer = creator,
        seeds = [b"vesting_vault", vesting_schedule.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = vesting_schedule,
        token::token_program = token_program,
    )]
    pub vesting_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Creator's token account
    #[account(mut)]
    pub creator_token_account: AccountInfo<'info>,

    /// CHECK: Fee collector wallet from platform config
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,

    /// CHECK: Fee collector's token account for token fees
    #[account(mut)]
    pub fee_collector_token_account: AccountInfo<'info>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(schedule_id: u64)]
pub struct ClaimVested<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vesting_schedule.creator.as_ref(), vesting_schedule.beneficiary.as_ref(), vesting_schedule.token_mint.as_ref(), &schedule_id.to_le_bytes()],
        bump = vesting_schedule.bump,
        constraint = vesting_schedule.beneficiary == beneficiary.key() @ ErrorCode::Unauthorized,
        constraint = !vesting_schedule.revoked @ ErrorCode::VestingRevoked,
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,
    
    /// CHECK: Vesting vault
    #[account(
        mut,
        constraint = vesting_vault.key() == vesting_schedule.vault @ ErrorCode::UnauthorizedVault
    )]
    pub vesting_vault: AccountInfo<'info>,
    
    /// CHECK: Beneficiary's token account, owner validated in instruction body
    #[account(mut)]
    pub beneficiary_token_account: AccountInfo<'info>,
    
    #[account(
        constraint = token_mint.key() == vesting_schedule.token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(schedule_id: u64)]
pub struct RevokeVesting<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vesting_schedule.creator.as_ref(), vesting_schedule.beneficiary.as_ref(), vesting_schedule.token_mint.as_ref(), &schedule_id.to_le_bytes()],
        bump = vesting_schedule.bump,
        constraint = vesting_schedule.creator == creator.key() @ ErrorCode::Unauthorized,
        constraint = vesting_schedule.revocable @ ErrorCode::VestingNotRevocable,
        constraint = !vesting_schedule.revoked @ ErrorCode::VestingRevoked,
    )]
    pub vesting_schedule: Account<'info, VestingSchedule>,
    
    /// CHECK: Vesting vault
    #[account(
        mut,
        constraint = vesting_vault.key() == vesting_schedule.vault @ ErrorCode::UnauthorizedVault
    )]
    pub vesting_vault: AccountInfo<'info>,
    
    /// CHECK: Creator's token account, owner validated in instruction body
    #[account(mut)]
    pub creator_token_account: AccountInfo<'info>,
    
    /// CHECK: Beneficiary's token account, owner validated in instruction body
    #[account(mut)]
    pub beneficiary_token_account: AccountInfo<'info>,
    
    #[account(
        constraint = token_mint.key() == vesting_schedule.token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct RefreshReflections1<'info> {
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        mut,
        seeds = [b"stake1", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake1>,
    
    /// CHECK: For Native SOL = Project PDA, For SPL = Project PDA's standard ATA
    #[account(
        mut,
        constraint = Some(reflection_vault.key()) == project.reflection_vault @ ErrorCode::InvalidReflectionVault
    )]
    pub reflection_vault: AccountInfo<'info>,
    
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct ClaimReflections1<'info> {
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        mut,
        seeds = [b"stake1", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake1>,
    
    /// CHECK: For Native SOL = Project PDA, For SPL = Project PDA's standard ATA
    #[account(
        mut,
        constraint = Some(reflection_vault.key()) == project.reflection_vault @ ErrorCode::InvalidReflectionVault
    )]
    pub reflection_vault: AccountInfo<'info>,
    
    /// CHECK: User's wallet (for Native SOL) or user's ATA (for SPL)
    #[account(mut)]
    pub user_reflection_account: AccountInfo<'info>,
    
    pub reflection_token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct DepositRewards1<'info> {
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project1>>,
    
    /// CHECK: Reward vault
    #[account(
        mut,
        constraint = reward_vault.key() == project.reward_vault @ ErrorCode::UnauthorizedVault
    )]
    pub reward_vault: AccountInfo<'info>,
    
    /// CHECK: Admin's token account for the reward token
    #[account(mut)]
    pub admin_token_account: AccountInfo<'info>,
    
    #[account(
        constraint = token_mint_account.key() == project.reward_token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub reward_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Withdraw1<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        mut,
        seeds = [b"stake1", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake1>,
    
    /// CHECK: Staking vault
    #[account(
        mut,
        constraint = staking_vault.key() == project.staking_vault @ ErrorCode::UnauthorizedVault
    )]
    pub staking_vault: AccountInfo<'info>,
    
    /// CHECK: Withdrawal destination
    #[account(mut)]
    pub withdrawal_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector token account
    #[account(mut)]
    pub fee_collector_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector wallet
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
    
    /// CHECK: Optional reflection vault
    pub reflection_vault: Option<AccountInfo<'info>>,
    
    #[account(
        constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Claim1<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        mut,
        seeds = [b"stake1", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake1>,
    
    /// CHECK: Reward vault
    #[account(
        mut,
        constraint = reward_vault.key() == project.reward_vault @ ErrorCode::UnauthorizedVault
    )]
    pub reward_vault: AccountInfo<'info>,
    
    /// CHECK: User token account for receiving rewards
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector wallet
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
    
    /// CHECK: Optional reflection vault
    pub reflection_vault: Option<AccountInfo<'info>>,
    
    #[account(
        constraint = token_mint_account.key() == project.reward_token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub reward_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Deposit1<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Stake1::INIT_SPACE,
        seeds = [b"stake1", project.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub stake: Account<'info, Stake1>,
    
    /// CHECK: Staking vault
    #[account(
        mut,
        constraint = staking_vault.key() == project.staking_vault @ ErrorCode::UnauthorizedVault
    )]
    pub staking_vault: AccountInfo<'info>,
    
    /// CHECK: User token account
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector token account
    #[account(mut)]
    pub fee_collector_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector wallet
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
    
    /// CHECK: Optional reflection vault
    pub reflection_vault: Option<AccountInfo<'info>>,
    
    #[account(
        constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType
    )]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct VestingSchedule {
    pub creator: Pubkey,
    pub beneficiary: Pubkey,
    pub schedule_id: u64,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub total_amount: u64,
    pub released_amount: u64,
    pub start_time: i64,
    pub cliff_seconds: u64,
    pub total_duration_seconds: u64,
    pub revocable: bool,
    pub revoked: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializePool1Params {
    pub rate_bps_per_year: u64,
    pub rate_mode: u8,
    pub lockup_seconds: u64,
    pub pool_duration_seconds: u64,
    pub referrer: Option<Pubkey>,
    pub referrer_split_bps: Option<u64>,
    pub enable_reflections: bool,
    pub reflection_token: Option<Pubkey>,
    pub custom_token_fee_bps: u64,
    pub custom_sol_fee: u64,
    pub use_custom_fees: bool,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64, params: InitializePool1Params)]
pub struct InitializePool1<'info> {
    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        seeds = [b"staking_vault1", project.key().as_ref()],
        bump,
        constraint = staking_vault.key() == project.staking_vault @ ErrorCode::UnauthorizedVault
    )]
    pub staking_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Optional reflection token mint
    pub reflection_token_mint: Option<AccountInfo<'info>>,
    
    /// CHECK: Reflection ATA
    #[account(mut)]
    pub reflection_token_account: Option<AccountInfo<'info>>,
    
    #[account(
        seeds = [b"platform_v2"],
        bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    /// CHECK: Only used if reflections enabled
    pub associated_token_program: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub reflection_token_program: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64, reward_token_mint: Pubkey)]
pub struct CreateProject1<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        init,
        payer = admin,
        space = 8 + Project1::INIT_SPACE,
        seeds = [b"project1", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump
    )]
    pub project: Box<Account<'info, Project1>>,
    
    #[account(
        init,
        payer = admin,
        seeds = [b"staking_vault1", project.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = project,
        token::token_program = token_program,
    )]
    pub staking_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = admin,
        seeds = [b"reward_vault1", project.key().as_ref()],
        bump,
        token::mint = reward_token_mint_account,
        token::authority = project,
        token::token_program = reward_token_program,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Fee collector wallet from platform config
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,
    pub reward_token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub reward_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct CreateProject<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Project::INIT_SPACE,
        seeds = [b"project", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        init,
        payer = admin,
        seeds = [b"staking_vault", project.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = project,
        token::token_program = token_program,
    )]
    pub staking_vault: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        init,
        payer = admin,
        seeds = [b"reward_vault", project.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = project,
        token::token_program = token_program,
    )]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64, params: InitializePoolParams)]
pub struct InitializePool<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        seeds = [b"staking_vault", project.key().as_ref()],
        bump,
    )]
    pub staking_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Optional reflection token mint - validated in instruction logic
    pub reflection_token_mint: Option<AccountInfo<'info>>,
    
    /// CHECK: Reflection ATA - manually validated/created
    #[account(mut)]
    pub reflection_token_account: Option<AccountInfo<'info>>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    /// CHECK: Only used if reflections enabled
    pub associated_token_program: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub reflection_token_program: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Stake::INIT_SPACE,
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub stake: Account<'info, Stake>,
    
    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(mut)]
    pub staking_vault: AccountInfo<'info>,
    
    /// CHECK: Can be wallet (Native SOL) or TokenAccount (SPL)
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
        
    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(mut)]
    pub fee_collector_token_account: AccountInfo<'info>,
        
    /// CHECK: Fee collector wallet - validated against platform
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
        
    /// CHECK: Optional reflection vault
    pub reflection_vault: Option<AccountInfo<'info>>,    
    #[account(constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType)]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        mut,
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake>,
    
    #[account(
        mut,
        seeds = [b"staking_vault", project.key().as_ref()],
        bump,
        constraint = staking_vault.mint == token_mint @ ErrorCode::WrongTokenType,
        constraint = staking_vault.key() == project.staking_vault @ ErrorCode::UnauthorizedVault
    )]
    pub staking_vault: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Can be wallet (Native SOL) or TokenAccount (SPL/Token-2022)
    /// Ownership validated in transfer_tokens function
    #[account(mut)]
    pub withdrawal_token_account: AccountInfo<'info>,

    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(mut)]
    pub fee_collector_token_account: AccountInfo<'info>,
        
    /// CHECK: Fee collector wallet - validated against platform
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
    
    /// CHECK: Optional reflection vault - can be staking_vault for Native SOL or ATA for SPL tokens
    pub reflection_vault: Option<AccountInfo<'info>>,
    
    #[account(constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType)]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct Claim<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        mut,
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake>,
    
    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(mut)]
    pub reward_vault: AccountInfo<'info>,
        
    /// CHECK: Can be wallet (Native SOL) or TokenAccount (SPL)
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    
    /// CHECK: Fee collector wallet - validated against platform
    #[account(
        mut,
        constraint = fee_collector.key() == platform.fee_collector @ ErrorCode::InvalidFeeCollector
    )]
    pub fee_collector: AccountInfo<'info>,
    
    /// CHECK: Optional reflection vault
    pub reflection_vault: Option<AccountInfo<'info>>,    
    #[account(constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType)]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct ClaimReflections<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        mut,
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake>,

    /// CHECK: For Native SOL = Project PDA, For SPL = Project PDA's standard ATA
    #[account(mut)]
    pub reflection_vault: AccountInfo<'info>,
    
    /// CHECK: User's wallet (for Native SOL) or user's ATA (for SPL)
    #[account(mut)]
    pub user_reflection_account: AccountInfo<'info>,
    
    pub reflection_token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct RefreshReflections<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    
    #[account(
        mut,
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake>,
    
    /// CHECK: For Native SOL = Project PDA, For SPL = Project PDA's standard ATA
    #[account(mut)]
    pub reflection_vault: AccountInfo<'info>,
    
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct DepositRewards<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project>>,
    
    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(
        mut,
        constraint = reward_vault.key() == project.reward_vault @ ErrorCode::UnauthorizedVault
    )]
    pub reward_vault: AccountInfo<'info>,
    
    /// CHECK: Can be TokenAccount (SPL) or wallet (Native SOL)
    #[account(mut)]
    pub admin_token_account: AccountInfo<'info>,
    
    #[account(constraint = token_mint_account.key() == project.token_mint @ ErrorCode::WrongTokenType)]
    pub token_mint_account: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct UpdateReferrer<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Account<'info, Project>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetFees<'info> {
    #[account(
        mut,
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct SetCustomFees1<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        mut,
        seeds = [b"project1", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project1>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct TransferAdmin<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Account<'info, Project>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    /// CHECK: New admin address
    pub new_admin: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateFeeCollector<'info> {
    #[account(
        mut,
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferPlatformAdmin<'info> {
    #[account(
        mut,
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 32 + 1,
        seeds = [b"pending_admin"],
        bump
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptPlatformAdmin<'info> {
    #[account(
        mut,
        seeds = [b"platform_v2"],
        bump = platform.bump
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        mut,
        seeds = [b"pending_admin"],
        bump = pending_admin.bump
    )]
    pub pending_admin: Account<'info, PendingAdmin>,

    #[account(mut)]
    pub new_admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct AdminSetReflectionToken<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,

    pub reflection_token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated in the instruction as either the project PDA (native SOL) or the reflection mint's ATA owned by the project PDA
    pub reflection_token_account: AccountInfo<'info>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct ExtendLock<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,

    #[account(
        seeds = [b"stake", project.key().as_ref(), user.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == user.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject,
        constraint = stake.amount > 0 @ ErrorCode::NoStake,
        constraint = project.total_staked == stake.amount @ ErrorCode::Unauthorized
    )]
    pub stake: Account<'info, Stake>,

    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct SettleStake<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,

    #[account(
        mut,
        seeds = [b"stake", project.key().as_ref(), stake.user.as_ref()],
        bump = stake.bump,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Account<'info, Stake>,

    #[account(
        seeds = [b"crank_authority"],
        bump = crank.bump,
        constraint = crank.authority == cranker.key() @ ErrorCode::Unauthorized
    )]
    pub crank: Account<'info, CrankAuthority>,

    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetCrankAuthority<'info> {
    #[account(
        seeds = [b"platform_v2"],
        bump = platform.bump,
        constraint = platform.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub platform: Account<'info, Platform>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 32 + 1,
        seeds = [b"crank_authority"],
        bump
    )]
    pub crank: Account<'info, CrankAuthority>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct SetDepositPaused<'info> {
    #[account(
        mut,
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Account<'info, Project>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64)]
pub struct RegisterExtraReward<'info> {
    #[account(
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project>>,

    #[account(
        init,
        payer = admin,
        space = 8 + ExtraReward::INIT_SPACE,
        seeds = [b"extra_reward", project.key().as_ref(), extra_mint.key().as_ref()],
        bump
    )]
    pub extra_reward: Account<'info, ExtraReward>,

    pub extra_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64, extra_mint: Pubkey)]
pub struct UpdateExtraRewardBeneficiary<'info> {
    #[account(
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub project: Box<Account<'info, Project>>,

    #[account(
        mut,
        seeds = [b"extra_reward", project.key().as_ref(), extra_mint.as_ref()],
        bump = extra_reward.bump,
        constraint = extra_reward.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub extra_reward: Account<'info, ExtraReward>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, pool_id: u64, extra_mint: Pubkey)]
pub struct ClaimExtraReward<'info> {
    #[account(
        seeds = [b"project", token_mint.as_ref(), &pool_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,

    #[account(
        seeds = [b"extra_reward", project.key().as_ref(), extra_mint.as_ref()],
        bump = extra_reward.bump,
        constraint = extra_reward.project == project.key() @ ErrorCode::InvalidProject,
        constraint = extra_reward.beneficiary == beneficiary.key() @ ErrorCode::Unauthorized
    )]
    pub extra_reward: Box<Account<'info, ExtraReward>>,

    #[account(
        seeds = [b"stake", project.key().as_ref(), beneficiary.key().as_ref()],
        bump = stake.bump,
        constraint = stake.user == beneficiary.key() @ ErrorCode::Unauthorized,
        constraint = stake.project == project.key() @ ErrorCode::InvalidProject
    )]
    pub stake: Box<Account<'info, Stake>>,

    #[account(
        mut,
        constraint = extra_vault.key() == extra_reward.vault @ ErrorCode::InvalidExtraRewardVault,
        constraint = extra_vault.mint == extra_reward.mint @ ErrorCode::InvalidExtraRewardVault,
        constraint = extra_vault.owner == project.key() @ ErrorCode::InvalidExtraRewardVault,
        constraint = extra_vault.key() != project.staking_vault @ ErrorCode::ExtraRewardMintConflict,
        constraint = extra_vault.key() != project.reward_vault @ ErrorCode::ExtraRewardMintConflict,
        constraint = project.reflection_vault.map_or(true, |v| extra_vault.key() != v) @ ErrorCode::ExtraRewardMintConflict,
        constraint = project.reflection_token.map_or(true, |t| extra_reward.mint != t) @ ErrorCode::ExtraRewardMintConflict
    )]
    pub extra_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = destination.mint == extra_reward.mint @ ErrorCode::InvalidExtraRewardVault,
        constraint = destination.owner == beneficiary.key()
            || destination.owner == stake.withdrawal_wallet @ ErrorCode::InvalidWithdrawalWallet
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = extra_mint_account.key() == extra_reward.mint @ ErrorCode::InvalidExtraRewardVault)]
    pub extra_mint_account: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(constraint = token_program.key() == *extra_mint_account.to_account_info().owner @ ErrorCode::WrongTokenType)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct PlatformAdminTransferred {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct PlatformAdminTransferProposed {
    pub current_admin: Pubkey,
    pub proposed_admin: Pubkey,
}

#[account]
pub struct PendingAdmin {
    pub pending: Pubkey,
    pub bump: u8,
}

#[account]
pub struct CrankAuthority {
    pub authority: Pubkey,
    pub bump: u8,
}

#[event]
pub struct CustomFeesUpdated {
    pub project: Pubkey,
    pub use_custom_fees: bool,
    pub custom_token_fee_bps: u64,
    pub custom_sol_fee: u64,
}

#[event]
pub struct LockExtended {
    pub project: Pubkey,
    pub user: Pubkey,
    pub old_lockup_seconds: u64,
    pub new_lockup_seconds: u64,
}

#[event]
pub struct ExtraRewardRegistered {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
}

#[event]
pub struct ExtraRewardBeneficiaryUpdated {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub old_beneficiary: Pubkey,
    pub new_beneficiary: Pubkey,
}

#[event]
pub struct ExtraRewardClaimed {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub beneficiary: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VestingCreated {
    pub creator: Pubkey,
    pub beneficiary: Pubkey,
    pub schedule_id: u64,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub cliff_seconds: u64,
    pub total_duration_seconds: u64,
    pub revocable: bool,
}

#[event]
pub struct VestingClaimed {
    pub beneficiary: Pubkey,
    pub amount: u64,
    pub total_released: u64,
}

#[event]
pub struct VestingRevoked {
    pub creator: Pubkey,
    pub beneficiary: Pubkey,
    pub unvested_returned: u64,
    pub vested_sent_to_beneficiary: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Platform {
    pub admin: Pubkey,
    pub fee_collector: Pubkey,
    pub platform_token_fee_bps: u64,
    pub platform_sol_fee: u64,
    pub is_initialized: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Project {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub pool_id: u64,
    pub staking_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub reflection_vault: Option<Pubkey>,
    pub reflection_token: Option<Pubkey>,
    
    pub total_staked: u64,
    pub total_rewards_deposited: u64,
    pub total_rewards_claimed: u64,
    
    pub rate_bps_per_year: u64,
    pub rate_mode: u8,
    pub reward_rate_per_second: u64,
    pub lockup_seconds: u64,
    pub pool_duration_seconds: u64,
    pub pool_start_time: i64,
    pub pool_end_time: i64,
    
    pub last_update_time: i64,
    pub reward_per_token_stored: u64,
    pub reflection_per_token_stored: u64,
    pub last_reflection_update_time: i64,
    pub last_reflection_balance: u64,
    
    pub referrer: Option<Pubkey>,
    pub referrer_split_bps: u64,
    
    pub is_paused: bool,
    pub deposit_paused: bool,
    pub withdraw_paused: bool,
    pub claim_paused: bool,
    pub is_initialized: bool,
    pub enable_reflections: bool,
    
    pub bump: u8,
    pub total_reflection_debt: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Stake {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub last_stake_timestamp: i64,
    pub withdrawal_wallet: Pubkey,
    pub reward_per_token_paid: u64,
    pub rewards_pending: u64,
    pub total_rewards_claimed: u64,
    pub reflection_per_token_paid: u64,
    pub reflections_pending: u64,
    pub total_reflections_claimed: u64,
    pub reflection_debt: u64,
    pub reward_rate_snapshot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Project1 {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub pool_id: u64,
    pub staking_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub reward_token_mint: Pubkey,
    pub reward_token_decimals: u8,
    pub reflection_vault: Option<Pubkey>,
    pub reflection_token: Option<Pubkey>,

    pub total_staked: u64,
    pub total_rewards_deposited: u64,
    pub total_rewards_claimed: u128,

    pub rate_bps_per_year: u64,
    pub rate_mode: u8,
    pub reward_rate_per_second: u64,
    pub lockup_seconds: u64,
    pub pool_duration_seconds: u64,
    pub pool_start_time: i64,
    pub pool_end_time: i64,

    pub last_update_time: i64,
    pub reward_per_token_stored: u128,
    pub reflection_per_token_stored: u64,
    pub last_reflection_update_time: i64,
    pub last_reflection_balance: u64,

    pub referrer: Option<Pubkey>,
    pub referrer_split_bps: u64,

    pub is_paused: bool,
    pub deposit_paused: bool,
    pub withdraw_paused: bool,
    pub claim_paused: bool,
    pub is_initialized: bool,
    pub enable_reflections: bool,

    pub custom_token_fee_bps: u64,
    pub custom_sol_fee: u64,
    pub use_custom_fees: bool,

    pub bump: u8,
    pub total_reflection_debt: u64,
}

#[account]
#[derive(InitSpace)]
pub struct ExtraReward {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Stake1 {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub last_stake_timestamp: i64,
    pub claim_timestamp: i64,
    pub withdrawal_wallet: Pubkey,
    pub reward_per_token_paid: u128,
    pub rewards_pending: u128,
    pub total_rewards_claimed: u128,
    pub reflection_per_token_paid: u64,
    pub reflections_pending: u64,
    pub total_reflections_claimed: u64,
    pub reflection_debt: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializePoolParams {
    pub rate_bps_per_year: u64,
    pub rate_mode: u8,
    pub lockup_seconds: u64,
    pub pool_duration_seconds: u64,
    pub referrer: Option<Pubkey>,
    pub referrer_split_bps: Option<u64>,
    pub enable_reflections: bool,
    pub reflection_token: Option<Pubkey>,  // ← ADD THIS LINE
}

#[event]
pub struct PlatformInitialized {
    pub admin: Pubkey,
    pub fee_collector: Pubkey,
    pub platform_token_fee_bps: u64,
    pub platform_sol_fee: u64,
}

#[event]
pub struct ProjectCreated {
    pub project: Pubkey,
    pub token_mint: Pubkey,
    pub staking_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct PoolInitialized {
    pub project: Pubkey,
    pub staking_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub rate_bps_per_year: u64,
    pub rate_mode: u8,
    pub lockup_seconds: u64,
    pub pool_duration_seconds: u64,
    pub reflections_enabled: bool,
}

#[event]
pub struct TokensDeposited {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub token_fee: u64,
    pub sol_fee: u64,
    pub new_total: u64,
}

#[event]
pub struct TokensWithdrawn {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub remaining: u64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ReflectionsClaimed {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RewardsDeposited {
    pub project: Pubkey,
    pub amount: u64,
    pub total_rewards: u64,
    pub reward_rate: u64,
}

#[event]
pub struct ReferrerUpdated {
    pub project: Pubkey,
    pub referrer: Option<Pubkey>,
    pub split_bps: u64,
}

#[event]
pub struct FeesUpdated {
    pub platform_token_fee_bps: u64,
    pub platform_sol_fee: u64,
}

#[event]
pub struct ProjectPaused {
    pub project: Pubkey,
}

#[event]
pub struct ProjectUnpaused {
    pub project: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub project: Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct FeeCollectorUpdated {
    pub old_fee_collector: Pubkey,
    pub new_fee_collector: Pubkey,
}

#[event]
pub struct ReflectionTokenCorrected {
    pub project: Pubkey,
    pub old_token: Option<Pubkey>,
    pub new_token: Pubkey,
    pub old_vault: Option<Pubkey>,
    pub new_vault: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Project is paused")]
    ProjectPaused,
    #[msg("Deposits are paused")]
    DepositsPaused,
    #[msg("Withdrawals are paused")]
    WithdrawalsPaused,
    #[msg("Claims are paused")]
    ClaimsPaused,
    #[msg("Lockup period not expired")]
    LockupNotExpired,
    #[msg("No stake found")]
    NoStake,
    #[msg("No rewards available")]
    NoRewards,
    #[msg("No reflections available")]
    NoReflections,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Already initialized")]
    AlreadyInitialized,
    #[msg("Not initialized")]
    NotInitialized,
    #[msg("Invalid split percentage")]
    InvalidSplitPercentage,
    #[msg("Reflection vault required")]
    ReflectionVaultRequired,
    #[msg("Reflection token required")]
    ReflectionTokenRequired,
    #[msg("Reflections not enabled")]
    ReflectionsNotEnabled,
    #[msg("Insufficient SOL for fee - would leave account below rent-exempt minimum")]
    InsufficientSolForFee,
    #[msg("Referrer address does not match project referrer")]
    InvalidReferrer,
    #[msg("Insufficient balance in vault")]
    InsufficientVaultBalance,
    #[msg("Insufficient rewards in reward vault")]
    InsufficientRewardVault,
    #[msg("Insufficient reflections in reflection vault")]
    InsufficientReflectionVault,
    #[msg("No stakers in pool")]
    NoStakers,
    #[msg("Invalid pool duration - must be greater than 0")]
    InvalidPoolDuration,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Invalid fee collector")]
    InvalidFeeCollector,
    #[msg("Calculated APR exceeds maximum u64 value")]
    AprTooHigh,
    #[msg("Wrong token type - must match project token mint")]
    WrongTokenType,
    #[msg("Unauthorized vault - must belong to this project")]
    UnauthorizedVault,
    #[msg("Invalid withdrawal wallet - does not match stake withdrawal_wallet")]
    InvalidWithdrawalWallet,
    #[msg("Vesting schedule has been revoked")]
    VestingRevoked,
    #[msg("Vesting schedule is not revocable")]
    VestingNotRevocable,
    #[msg("Cliff period has not ended")]
    CliffNotEnded,
    #[msg("Invalid reflection vault - does not match project reflection vault")]
    InvalidReflectionVault,
    #[msg("Invalid project - stake does not belong to this project")]
    InvalidProject,
    #[msg("Inconsistent total staked - total_staked is less than withdrawal amount")]
    InconsistentTotalStaked,
    #[msg("Invalid timestamp - clock moved backwards")]
    InvalidTimestamp,
    #[msg("Pool has ended - cannot deposit after pool end time")]
    PoolEnded,
    #[msg("Invalid rate mode - must be 0 (fixed APY) or 1 (variable APR)")]
    InvalidRateMode,
    #[msg("Missing Associated Token Program - required when reflections are enabled")]
    MissingAssociatedTokenProgram,
    #[msg("Please refresh reflections before claiming - new tokens have arrived in the vault")]
    RefreshRequired,
    #[msg("Invalid rate BPS - must be less than or equal to 1,000,000")]
    InvalidRateBps,
     #[msg("Invalid referrer split - must be less than or equal to 10,000 BPS (100%)")]
    InvalidReferrerSplit,
    #[msg("No reflections to claim - refresh reflections first")]
    NoReflectionsToClaim,
    #[msg("Cannot change reflection token after reflections have accrued")]
    ReflectionAlreadyAccrued,
    #[msg("Invalid extra reward vault")]
    InvalidExtraRewardVault,
    #[msg("Extra reward mint conflicts with an existing vault or token")]
    ExtraRewardMintConflict,
    #[msg("Native SOL is not supported for extra rewards")]
    ExtraRewardNativeSolUnsupported,
    #[msg("Nothing to claim from this extra reward vault")]
    NoExtraRewardToClaim,
    #[msg("New lock duration must be longer than the current one")]
    LockCannotBeShortened,
    #[msg("This instruction is only available on locks")]
    NotALock,
    #[msg("Lock duration exceeds the maximum allowed")]
    LockupTooLong,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("Native SOL is not supported as a staking or reward asset")]
    NativeSolUnsupported,
    #[msg("Only the lock owner can deposit into this lock")]
    LockNotOwnedByDepositor,
    #[msg("The mint argument does not match the supplied mint account")]
    MintArgumentMismatch,
    #[msg("The configured reflection mint does not match the reflection account")]
    ReflectionMintMismatch,
    #[msg("Fixed APY requires the reward token to be the staking token")]
    FixedModeRequiresSameMint,
    #[msg("Deposit is too small to increase the reward rate")]
    ZeroRateIncrement,
}

// 100 years. Far above any legitimate lock and far below the point where a
// u64 lockup casts to a negative i64 in the withdraw comparison.
pub const MAX_LOCKUP_SECONDS: u64 = 3_153_600_000;
pub const MAX_PLATFORM_FEE_BPS: u64 = 1_000;
pub const MAX_PLATFORM_SOL_FEE: u64 = 100_000_000;