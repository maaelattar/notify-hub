import { IsInt, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class Pagination {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  private readonly _page: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  private readonly _limit: number;

  constructor(page: number = 1, limit: number = 20) {
    this._page = Math.max(1, page);
    this._limit = Math.max(1, Math.min(100, limit));
  }

  get page(): number {
    return this._page;
  }

  get limit(): number {
    return this._limit;
  }

  get offset(): number {
    return (this._page - 1) * this._limit;
  }

  get skip(): number {
    return this.offset;
  }

  get take(): number {
    return this._limit;
  }

  static create(page?: number, limit?: number): Pagination {
    return new Pagination(page, limit);
  }

  static fromQuery(query: { page?: number; limit?: number }): Pagination {
    return new Pagination(query.page, query.limit);
  }

  withPage(page: number): Pagination {
    return new Pagination(page, this._limit);
  }

  withLimit(limit: number): Pagination {
    return new Pagination(this._page, limit);
  }

  calculateTotalPages(totalItems: number): number {
    return Math.ceil(totalItems / this._limit);
  }

  hasNext(totalItems: number): boolean {
    return this._page < this.calculateTotalPages(totalItems);
  }

  hasPrevious(): boolean {
    return this._page > 1;
  }

  toJSON() {
    return {
      page: this._page,
      limit: this._limit,
      offset: this.offset,
    };
  }
}
