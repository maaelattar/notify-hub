import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailService } from './modules/channels/email/services/email.service';

describe('AppController', () => {
  let appController: AppController;
  let mockEmailService: jest.Mocked<EmailService>;

  beforeEach(async () => {
    // Create mock EmailService
    mockEmailService = {
      send: jest.fn(),
      validateConfiguration: jest.fn(),
      getHealthStatus: jest.fn(),
    } as any;

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
