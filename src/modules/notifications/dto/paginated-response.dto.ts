import { ApiProperty } from '@nestjs/swagger';
import { Pagination } from '../../../common/value-objects/pagination.vo';

export class PaginatedResponseDto<T> {
  @ApiProperty({
    description: 'Array of items for the current page',
    isArray: true,
  })
  data: T[];

  @ApiProperty({
    example: 100,
    description: 'Total number of items across all pages',
  })
  total: number;

  @ApiProperty({
    example: 1,
    description: 'Current page number',
  })
  page: number;

  @ApiProperty({
    example: 20,
    description: 'Number of items per page',
  })
  limit: number;

  @ApiProperty({
    example: 5,
    description: 'Total number of pages',
  })
  totalPages: number;

  @ApiProperty({
    example: true,
    description: 'Whether there is a next page',
  })
  hasNext: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether there is a previous page',
  })
  hasPrevious: boolean;

  constructor(data: T[], total: number, pagination: Pagination) {
    this.data = data;
    this.total = total;
    this.page = pagination.page;
    this.limit = pagination.limit;
    this.totalPages = pagination.calculateTotalPages(total);
    this.hasNext = pagination.hasNext(total);
    this.hasPrevious = pagination.hasPrevious();
  }

  static create<T>(
    data: T[],
    total: number,
    pagination: Pagination,
  ): PaginatedResponseDto<T> {
    return new PaginatedResponseDto(data, total, pagination);
  }
}
