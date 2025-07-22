import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailService } from './modules/channels/email/services/email.service';

describe('AppController', () => {
  let appController: AppController;
  let mockAppService: any;
  let mockEmailService: any;

  beforeEach(() => {
    // Create simple mocks for the controller dependencies
    mockAppService = {
      getHello: vi.fn().mockReturnValue('Hello World!'),
    };

    mockEmailService = {
      send: vi.fn(),
      validateConfiguration: vi.fn(),
      getHealthStatus: vi.fn(),
    };

    // Create controller instance directly with mocked dependencies
    appController = new AppController(mockAppService, mockEmailService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
