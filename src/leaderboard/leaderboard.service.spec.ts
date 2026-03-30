import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { LeaderboardService } from './leaderboard.service';
import { RewardTransaction } from '../rewards/entities/reward-transaction.entity';
import { RewardStatus } from '../rewards/enums/reward-status.enum';

// Mock Redis client interface
interface MockRedisClient {
  zrevrange: jest.Mock;
  zrevrank: jest.Mock;
  zscore: jest.Mock;
  hmget: jest.Mock;
  pipeline: jest.Mock;
  del: jest.Mock;
  zadd: jest.Mock;
  hmset: jest.Mock;
  exec: jest.Mock;
}

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let mockRedisClient: MockRedisClient;
  let mockPipeline: {
    del: jest.Mock;
    zadd: jest.Mock;
    hmset: jest.Mock;
    exec: jest.Mock;
  };

  const mockRewardRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    stores: { client: {} },
  };

  beforeEach(async () => {
    mockPipeline = {
      del: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      hmset: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    mockRedisClient = {
      zrevrange: jest.fn(),
      zrevrank: jest.fn(),
      zscore: jest.fn(),
      hmget: jest.fn(),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      del: jest.fn(),
      zadd: jest.fn(),
      hmset: jest.fn(),
      exec: jest.fn(),
    };

    (mockCacheManager.stores as any).client = mockRedisClient;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: getRepositoryToken(RewardTransaction),
          useValue: mockRewardRepo,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    const userId = 'user-123';

    it('should return global leaderboard when no country code provided', async () => {
      // zrevrange returns [id, score, id, score, ...] flat array
      mockRedisClient.zrevrange.mockResolvedValue([
        'user-1', '100',
        'user-2', '80',
        'user-3', '60',
      ]);
      mockRedisClient.hmget.mockResolvedValue(['Alice A.', 'Bob B.', 'Charlie C.']);
      mockRedisClient.zrevrank.mockResolvedValue(5); // user-123 is rank 6
      mockRedisClient.zscore.mockResolvedValue('40');

      const result = await service.getLeaderboard(userId, 50);

      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
        'leaderboard:global',
        0,
        49,
        'WITHSCORES',
      );
      expect(result.topRankings).toHaveLength(3);
      expect(result.topRankings[0]).toEqual({
        rank: 1,
        userId: 'user-1',
        displayName: 'Alice A.',
        totalXlm: 100,
        country: 'Global',
      });
      expect(result.myRank).toEqual({ rank: 6, totalXlm: 40 });
    });

    it('should return country-specific leaderboard when country code provided', async () => {
      const countryCode = 'US';

      mockRedisClient.zrevrange.mockResolvedValue([
        'user-1', '50',
        'user-2', '30',
      ]);
      mockRedisClient.hmget.mockResolvedValue(['US Alice', 'US Bob']);
      mockRedisClient.zrevrank.mockResolvedValue(0);
      mockRedisClient.zscore.mockResolvedValue('50');

      const result = await service.getLeaderboard(userId, 50, countryCode);

      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
        'leaderboard:country:US',
        0,
        49,
        'WITHSCORES',
      );
      expect(result.topRankings[0].country).toBe('US');
    });

    it('should handle empty leaderboard', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([]);
      mockRedisClient.hmget.mockResolvedValue([]);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard(userId, 50);

      expect(result.topRankings).toHaveLength(0);
      expect(result.myRank).toEqual({ rank: null, totalXlm: 0 });
    });

    it('should handle user not on leaderboard', async () => {
      mockRedisClient.zrevrange.mockResolvedValue(['user-1', '100', 'user-2', '80']);
      mockRedisClient.hmget.mockResolvedValue(['Alice A.', 'Bob B.']);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard(userId, 50);

      expect(result.myRank).toEqual({ rank: null, totalXlm: 0 });
    });

    it('should use default limit of 50 when not provided', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([]);
      mockRedisClient.hmget.mockResolvedValue([]);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      await service.getLeaderboard(userId);

      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
        'leaderboard:global',
        0,
        49,
        'WITHSCORES',
      );
    });

    it('should respect pagination via limit parameter', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([]);
      mockRedisClient.hmget.mockResolvedValue([]);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      await service.getLeaderboard(userId, 10);

      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
        'leaderboard:global',
        0,
        9,
        'WITHSCORES',
      );
    });

    it('should handle missing display names gracefully', async () => {
      mockRedisClient.zrevrange.mockResolvedValue(['user-1', '100', 'user-2', '80']);
      mockRedisClient.hmget.mockResolvedValue(['Alice A.', null]);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard(userId, 50);

      expect(result.topRankings[1].displayName).toBe('Anonymous');
    });

    it('should correctly calculate ranks starting from 1', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([
        'user-1', '100',
        'user-2', '90',
        'user-3', '80',
      ]);
      mockRedisClient.hmget.mockResolvedValue(['A', 'B', 'C']);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard(userId, 50);

      expect(result.topRankings[0].rank).toBe(1);
      expect(result.topRankings[1].rank).toBe(2);
      expect(result.topRankings[2].rank).toBe(3);
    });
  });

  describe('rebuildLeaderboards', () => {
    it('should rebuild global and country leaderboards from reward transactions', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: 'user-1', totalXlm: '100', fullName: 'Alice Anderson', country: 'US' },
          { userId: 'user-2', totalXlm: '80', fullName: 'Bob Brown', country: 'US' },
          { userId: 'user-3', totalXlm: '60', fullName: 'Charlie Chen', country: 'UK' },
        ]),
      };
      mockRewardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.rebuildLeaderboards();

      // Verify global leaderboard was cleared
      expect(mockPipeline.del).toHaveBeenCalledWith('leaderboard:global');

      // Verify zadd was called for each user in global and country sets
      // user-1: global + US = 2
      // user-2: global + US = 2
      // user-3: global + UK = 2
      // Total = 6 zadd calls
      expect(mockPipeline.zadd).toHaveBeenCalledTimes(6);

      // Verify names metadata was updated
      expect(mockPipeline.hmset).toHaveBeenCalledWith(
        'leaderboard:metadata:names',
        expect.objectContaining({
          'user-1': 'Alice A.',
          'user-2': 'Bob B.',
          'user-3': 'Charlie C.',
        }),
      );

      // Verify pipeline exec was called
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should handle empty reward data gracefully', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockRewardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.rebuildLeaderboards();

      expect(mockPipeline.del).toHaveBeenCalledWith('leaderboard:global');
      // hmset should not be called when nameMap is empty
      expect(mockPipeline.hmset).not.toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should filter transactions by SUCCESS status and current month', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockRewardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.rebuildLeaderboards();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'rt.status = :status',
        { status: RewardStatus.SUCCESS },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'rt.createdAt >= :startOfMonth',
        expect.objectContaining({ startOfMonth: expect.any(Date) }),
      );
    });
  });

  describe('formatDisplayName', () => {
    it('should format full name with first name and last initial', () => {
      const result = (service as any).formatDisplayName('Alice Anderson');
      expect(result).toBe('Alice A.');
    });

    it('should handle single name as-is', () => {
      const result = (service as any).formatDisplayName('Alice');
      expect(result).toBe('Alice');
    });

    it('should handle multi-part first name and single last name', () => {
      const result = (service as any).formatDisplayName('Mary Jane Watson');
      expect(result).toBe('Mary W.');
    });

    it('should handle names with extra whitespace', () => {
      const result = (service as any).formatDisplayName('  Alice   Anderson  ');
      expect(result).toBe('Alice A.');
    });
  });

  describe('tie-breaking in leaderboard', () => {
    it('should handle users with the same score (sorted by rank order)', async () => {
      // When scores are equal, zrevrange returns them in insertion order
      // The rank is based on array index + 1
      mockRedisClient.zrevrange.mockResolvedValue([
        'user-1', '100',
        'user-2', '100',
        'user-3', '100',
      ]);
      mockRedisClient.hmget.mockResolvedValue(['Alice', 'Bob', 'Charlie']);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard('user-123', 50);

      expect(result.topRankings).toHaveLength(3);
      // All three have same score but different ranks
      expect(result.topRankings[0].rank).toBe(1);
      expect(result.topRankings[1].rank).toBe(2);
      expect(result.topRankings[2].rank).toBe(3);
    });

    it('should correctly rank mixed scores in descending order', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([
        'user-1', '100',
        'user-2', '50',
        'user-3', '25',
      ]);
      mockRedisClient.hmget.mockResolvedValue(['Top', 'Mid', 'Low']);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      const result = await service.getLeaderboard('user-123', 50);

      expect(result.topRankings[0].totalXlm).toBe(100);
      expect(result.topRankings[1].totalXlm).toBe(50);
      expect(result.topRankings[2].totalXlm).toBe(25);
      expect(result.topRankings[0].rank).toBe(1);
      expect(result.topRankings[1].rank).toBe(2);
      expect(result.topRankings[2].rank).toBe(3);
    });
  });

  describe('category separation', () => {
    it('should use country-specific key for country leaderboard', async () => {
      mockRedisClient.zrevrange.mockResolvedValue([]);
      mockRedisClient.hmget.mockResolvedValue([]);
      mockRedisClient.zrevrank.mockResolvedValue(null);
      mockRedisClient.zscore.mockResolvedValue(null);

      await service.getLeaderboard('user-123', 50, 'CA');

      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
        'leaderboard:country:CA',
        0,
        49,
        'WITHSCORES',
      );
    });

    it('should separate leaderboards by country in rebuild', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: 'user-1', totalXlm: '100', fullName: 'Alice A.', country: 'US' },
          { userId: 'user-2', totalXlm: '80', fullName: 'Bob B.', country: 'UK' },
        ]),
      };
      mockRewardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.rebuildLeaderboards();

      // Should have zadd calls for: global, US, UK (3 total users + 2 country sets)
      // user-1 -> global + US
      // user-2 -> global + UK
      expect(mockPipeline.zadd).toHaveBeenCalledWith('leaderboard:global', 100, 'user-1');
      expect(mockPipeline.zadd).toHaveBeenCalledWith('leaderboard:country:US', 100, 'user-1');
      expect(mockPipeline.zadd).toHaveBeenCalledWith('leaderboard:global', 80, 'user-2');
      expect(mockPipeline.zadd).toHaveBeenCalledWith('leaderboard:country:UK', 80, 'user-2');
    });
  });
});
