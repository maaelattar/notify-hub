import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ErrorGuidanceFactory,
  ErrorGuidance,
  ValidationErrorStrategy,
  ResourceNotFoundStrategy,
  RateLimitStrategy,
} from './error-guidance.factory';

describe('ErrorGuidanceFactory', () => {
  let factory: ErrorGuidanceFactory;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorGuidanceFactory,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    factory = module.get<ErrorGuidanceFactory>(ErrorGuidanceFactory);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(factory).toBeDefined();
  });

  describe('createGuidance', () => {
    it('should create validation error guidance', () => {
      const guidance = factory.createGuidance('VALIDATION_ERROR', 400);

      expect(guidance).toBeDefined();
      expect(guidance?.getMessage()).toBe(
        'Please check the request format and ensure all required fields are provided correctly.',
      );

      const guidanceData = guidance?.toJSON();
      expect(guidanceData?.documentation).toBe(
        'http://localhost:3000/api#/notifications',
      );
    });

    it('should create resource not found guidance', () => {
      const guidance = factory.createGuidance('RESOURCE_NOT_FOUND', 404);

      expect(guidance).toBeDefined();
      expect(guidance?.getMessage()).toBe(
        'The requested notification was not found. Please verify the notification ID.',
      );
      expect(guidance?.getActions()).toHaveLength(3);
    });

    it('should create rate limit guidance', () => {
      const guidance = factory.createGuidance('TOO_MANY_REQUESTS', 429);

      expect(guidance).toBeDefined();
      expect(guidance?.getMessage()).toBe(
        'Rate limit exceeded. Please slow down your requests.',
      );

      const guidanceData = guidance?.toJSON();
      expect(guidanceData?.retryAfter).toBe('60 seconds');
    });

    it('should create server error guidance for status 500', () => {
      const guidance = factory.createGuidance('UNKNOWN_ERROR', 500);

      expect(guidance).toBeDefined();
      expect(guidance?.getMessage()).toBe(
        'An unexpected error occurred. Our team has been notified.',
      );

      const guidanceData = guidance?.toJSON();
      expect(guidanceData?.support).toBe('support@notifyhub.com');
    });

    it('should return null for unsupported error codes', () => {
      const guidance = factory.createGuidance('UNKNOWN_CODE', 400);

      expect(guidance).toBeNull();
    });

    it('should handle NOT_FOUND alias', () => {
      const guidance = factory.createGuidance('NOT_FOUND', 404);

      expect(guidance).toBeDefined();
      expect(guidance?.getMessage()).toBe(
        'The requested notification was not found. Please verify the notification ID.',
      );
    });
  });

  describe('registerStrategy', () => {
    it('should allow registering custom strategies', () => {
      const customStrategy = new ValidationErrorStrategy();
      factory.registerStrategy('CUSTOM_ERROR', customStrategy);

      const supportedCodes = factory.getSupportedCodes();
      expect(supportedCodes).toContain('CUSTOM_ERROR');

      const guidance = factory.createGuidance('CUSTOM_ERROR', 400);
      expect(guidance).toBeDefined();
    });
  });

  describe('getSupportedCodes', () => {
    it('should return all registered error codes', () => {
      const codes = factory.getSupportedCodes();

      expect(codes).toContain('VALIDATION_ERROR');
      expect(codes).toContain('RESOURCE_NOT_FOUND');
      expect(codes).toContain('NOT_FOUND');
      expect(codes).toContain('TOO_MANY_REQUESTS');
      expect(codes).toContain('DUPLICATE_RESOURCE');
      expect(codes).toContain('INVALID_STATE');
    });
  });
});

describe('ErrorGuidance Value Object', () => {
  it('should create guidance with required fields', () => {
    const guidance = ErrorGuidance.create({
      message: 'Test error message',
    });

    expect(guidance.getMessage()).toBe('Test error message');
    expect(guidance.getActions()).toEqual([]);
    expect(guidance.getDocumentation()).toBeUndefined();
  });

  it('should create guidance with all fields', () => {
    const guidance = ErrorGuidance.create({
      message: 'Test error message',
      documentation: 'https://docs.example.com',
      actions: ['Action 1', 'Action 2'],
      retryAfter: '30 seconds',
      support: 'support@example.com',
    });

    expect(guidance.getMessage()).toBe('Test error message');
    expect(guidance.getDocumentation()).toBe('https://docs.example.com');
    expect(guidance.getActions()).toEqual(['Action 1', 'Action 2']);

    const data = guidance.toJSON();
    expect(data.retryAfter).toBe('30 seconds');
    expect(data.support).toBe('support@example.com');
  });

  it('should throw error for empty message', () => {
    expect(() => {
      ErrorGuidance.create({ message: '' });
    }).toThrow('ErrorGuidance message cannot be empty');
  });

  it('should throw error for undefined message', () => {
    expect(() => {
      ErrorGuidance.create({ message: undefined as any });
    }).toThrow('ErrorGuidance message cannot be empty');
  });
});

describe('Individual Strategy Classes', () => {
  const baseUrl = 'http://localhost:3000';

  describe('ValidationErrorStrategy', () => {
    it('should create proper guidance', () => {
      const strategy = new ValidationErrorStrategy();
      const guidance = strategy.createGuidance(baseUrl);

      expect(guidance.getMessage()).toContain('request format');
      expect(guidance.getDocumentation()).toBe(
        'http://localhost:3000/api#/notifications',
      );
    });
  });

  describe('ResourceNotFoundStrategy', () => {
    it('should create proper guidance', () => {
      const strategy = new ResourceNotFoundStrategy();
      const guidance = strategy.createGuidance(baseUrl);

      expect(guidance.getMessage()).toContain('not found');
      expect(guidance.getActions()).toHaveLength(3);
    });
  });

  describe('RateLimitStrategy', () => {
    it('should create proper guidance', () => {
      const strategy = new RateLimitStrategy();
      const guidance = strategy.createGuidance(baseUrl);

      expect(guidance.getMessage()).toContain('Rate limit');
      expect(guidance.toJSON().retryAfter).toBe('60 seconds');
    });
  });
});
