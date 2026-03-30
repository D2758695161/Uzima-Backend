import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/**
 * Scheduled jobs for the rewards module.
 * Handles daily reset of XLM reward counters at midnight UTC.
 */
@Injectable()
export class RewardsScheduler {
  private readonly logger = new Logger(RewardsScheduler.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Cron job: Reset daily XLM reward counters for all users at midnight UTC.
   * Runs every day at 00:00:00 UTC.
   * This ensures users' daily reward limits are refreshed for the new day.
   */
  @Cron('0 0 0 * * *', { name: 'dailyRewardReset' }) // Midnight UTC
  async resetDailyRewardCounters(): Promise<void> {
    this.logger.log('Starting daily reward counter reset job');

    try {
      const today = this.getUtcDateString(new Date());

      // Reset all users whose dailyRewardResetDate is not today
      const result = await this.userRepository
        .createQueryBuilder()
        .update(User)
        .set({
          dailyXlmEarned: () => '0',
          dailyRewardResetDate: today,
        } as any)
        .where('dailyRewardResetDate IS NULL OR dailyRewardResetDate != :today', { today })
        .execute();

      this.logger.log(
        `Daily reward counter reset completed. Updated ${result.affected ?? 0} users.`,
      );
    } catch (error) {
      this.logger.error(
        `Daily reward counter reset job failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Utility to convert Date to YYYY-MM-DD string in UTC.
   */
  private getUtcDateString(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
