import {
  Repository,
  FindOptionsWhere,
  EntityTarget,
  DataSource,
  ObjectLiteral,
} from 'typeorm';
import { Injectable } from '@nestjs/common';

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface SortOptions {
  field: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Base repository class that provides common CRUD operations
 * and standardized pagination logic to reduce code duplication
 */
@Injectable()
export abstract class BaseRepository<T extends ObjectLiteral> {
  protected repository: Repository<T>;

  constructor(
    protected readonly dataSource: DataSource,
    private readonly entityTarget: EntityTarget<T>,
  ) {
    this.repository = dataSource.getRepository(entityTarget);
  }

  /**
   * Create a new entity
   */
  async create(entityData: Partial<T>): Promise<T> {
    const entity = this.repository.create(entityData as any);
    return this.repository.save(entity) as unknown as Promise<T>;
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<T | null> {
    return this.repository.findOne({ where: { id } as any });
  }

  /**
   * Find all entities with optional filters and pagination
   */
  async findAll(
    where: FindOptionsWhere<T> = {},
    pagination: PaginationOptions = { page: 1, limit: 20 },
    sort: SortOptions = { field: 'createdAt', direction: 'DESC' },
    relations: string[] = [],
  ): Promise<PaginatedResult<T>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [data, total] = await this.repository.findAndCount({
      where,
      order: { [sort.field]: sort.direction } as any,
      skip,
      take: limit,
      relations,
    });

    return this.createPaginatedResult(data, total, pagination);
  }

  /**
   * Update entity by ID
   */
  async updateById(id: string, updates: Partial<T>): Promise<T | null> {
    const result = await this.repository.update({ id } as any, updates as any);

    if (!result.affected || result.affected === 0) {
      return null;
    }

    return this.findById(id);
  }

  /**
   * Delete entity by ID
   */
  async deleteById(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id } as any);
    return (
      result.affected !== null &&
      result.affected !== undefined &&
      result.affected > 0
    );
  }

  /**
   * Count entities with optional filters
   */
  async count(where: FindOptionsWhere<T> = {}): Promise<number> {
    return this.repository.count({ where });
  }

  /**
   * Check if entity exists by ID
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { id } as FindOptionsWhere<T>,
    });
    return count > 0;
  }

  /**
   * Create standardized paginated result
   */
  protected createPaginatedResult<TData>(
    data: TData[],
    total: number,
    pagination: PaginationOptions,
  ): PaginatedResult<TData> {
    const { page, limit } = pagination;
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNext,
      hasPrevious,
    };
  }

  /**
   * Execute operation within transaction
   */
  async withTransaction<TResult>(
    operation: (repository: Repository<T>) => Promise<TResult>,
  ): Promise<TResult> {
    return this.dataSource.transaction(async (manager) => {
      const transactionalRepository = manager.getRepository(this.entityTarget);
      return operation(transactionalRepository);
    });
  }

  /**
   * Get entity count grouped by a field
   */
  async getCountByField(
    field: keyof T,
    where: FindOptionsWhere<T> = {},
  ): Promise<Array<{ [K in keyof T]: T[K] } & { count: number }>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');

    // Add where conditions
    Object.keys(where).forEach((key, index) => {
      const value = (where as any)[key];
      if (value !== undefined) {
        if (index === 0) {
          queryBuilder.where(`entity.${key} = :${key}`, { [key]: value });
        } else {
          queryBuilder.andWhere(`entity.${key} = :${key}`, { [key]: value });
        }
      }
    });

    const results = await queryBuilder
      .select(`entity.${String(field)}`, String(field))
      .addSelect('COUNT(*)', 'count')
      .groupBy(`entity.${String(field)}`)
      .getRawMany();

    return results;
  }
}
