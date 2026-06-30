import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { RecordsService } from './records.service';

/**
 * RecordsController
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoints for Land Use Rights (LUR) records.
 * Base path: /api/records
 *
 * Planned endpoints:
 *   GET    /api/records            — list all records (paginated)
 *   GET    /api/records/:id        — get a single record by propertyId
 *   POST   /api/records            — create a new record (STATE_AUTHORITY only)
 *   PUT    /api/records/:id        — update a record (STATE_AUTHORITY only)
 *   DELETE /api/records/:id        — delete a record (STATE_AUTHORITY only)
 *
 * TODO:
 *  1. Add DTOs with class-validator decorators (CreatePropertyDto, UpdatePropertyDto)
 *  2. Add role-based guards (only STATE_AUTHORITY can write)
 *  3. Add pagination query params (page, limit)
 *  4. Add response transformation / serialization
 */
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  findAll() {
    // TODO: add pagination query params
    return this.recordsService.findAll();
  }

  @Get(':propertyId')
  findById(@Param('propertyId') propertyId: string) {
    return this.recordsService.findById(propertyId);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    // TODO: replace body type with CreatePropertyDto
    return this.recordsService.create(body);
  }

  @Put(':propertyId')
  update(@Param('propertyId') propertyId: string, @Body() body: Record<string, unknown>) {
    // TODO: replace body type with UpdatePropertyDto
    return this.recordsService.update(propertyId, body);
  }

  @Delete(':propertyId')
  remove(@Param('propertyId') propertyId: string) {
    return this.recordsService.remove(propertyId);
  }
}
