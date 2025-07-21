import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './entities/api-key.entity';
import { SecurityAuditLog } from './entities/security-audit.entity';
import { CryptoService } from './services/crypto.service';
import { SecurityAuditService } from './services/security-audit.service';
import { SecureApiKeyService } from './services/secure-api-key.service';
import { SecureApiKeyGuard } from './guards/secure-api-key.guard';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, SecurityAuditLog]),
    SharedModule, // For RedisProvider
  ],
  providers: [
    CryptoService,
    SecurityAuditService,
    SecureApiKeyService,
    SecureApiKeyGuard,
  ],
  exports: [
    CryptoService,
    SecurityAuditService,
    SecureApiKeyService,
    SecureApiKeyGuard,
    TypeOrmModule, // Export for other modules that might need these entities
  ],
})
export class AuthModule {}