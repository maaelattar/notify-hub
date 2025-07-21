import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs/promises';
import * as EmailValidator from 'email-validator';

import { EmailService } from './email.service';
import { EmailOptions } from '../interfaces/email.interface';

import { TestDataBuilder } from '../../../../test/test-utils';

// Mock external modules
jest.mock('nodemailer');
jest.mock('fs/promises');
jest.mock('email-validator');
jest.mock('handlebars', () => ({
  compile: jest
    .fn()
    .mockReturnValue((context: any) => `<h1>${context.content}</h1>`),
  registerHelper: jest.fn(),
}));

const mockNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;
const mockFs = fs as jest.Mocked<typeof fs>;
const mockEmailValidator = EmailValidator as jest.Mocked<typeof EmailValidator>;

describe('EmailService', () => {
  let service: EmailService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockTransporter: jest.Mocked<nodemailer.Transporter>;

  const mockEmailConfig = {
    ethereal: {
      enabled: false,
    },
    transport: {
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: {
        user: 'test@test.com',
        pass: 'password',
      },
    },
    defaults: {
      from: 'noreply@test.com',
    },
  } as const;

  beforeEach(async () => {
    // Create mock transporter
    mockTransporter = {
      sendMail: jest.fn(),
      verify: jest.fn(),
      isIdle: jest.fn(),
    } as unknown as jest.Mocked<nodemailer.Transporter>;

    // Create mocks
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'email') return mockEmailConfig;
        if (key === 'email.defaults.from') return mockEmailConfig.defaults.from;
        return null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    // Mock nodemailer
    mockNodemailer.createTransport.mockReturnValue(mockTransporter);
    mockNodemailer.createTestAccount.mockResolvedValue({
      user: 'test@ethereal.email',
      pass: 'password',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    } as nodemailer.TestAccount);
    mockNodemailer.getTestMessageUrl.mockReturnValue('http://preview.url');

    // Mock fs
    mockFs.readdir.mockResolvedValue(['notification.hbs'] as any);
    mockFs.readFile.mockResolvedValue('<h1>{{content}}</h1>');

    // Mock email validator
    mockEmailValidator.validate.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);

    // Mock the transporter verification to succeed
    (mockTransporter.verify as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should initialize with SMTP transporter when configured', async () => {
      // Act
      await service.onModuleInit();

      // Assert
      expect(mockNodemailer.createTransport).toHaveBeenCalledWith(
        mockEmailConfig.transport,
      );
      expect(mockTransporter.verify).toHaveBeenCalled();
      expect(mockFs.readdir).toHaveBeenCalled();
    });

    it('should initialize with Ethereal when enabled', async () => {
      // Arrange
      const etherealConfig = {
        ...mockEmailConfig,
        ethereal: { enabled: true },
      };
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'email') return etherealConfig;
        if (key === 'email.defaults.from') return mockEmailConfig.defaults.from;
        return null;
      });

      // Act
      await service.onModuleInit();

      // Assert
      expect(mockNodemailer.createTestAccount).toHaveBeenCalled();
      expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'test@ethereal.email',
          pass: 'password',
        },
      });
    });

    it('should handle transporter verification failure during initialization', async () => {
      // Arrange
      // Create a failing transporter mock
      const failingTransporter = {
        verify: jest.fn().mockRejectedValue(new Error('Connection failed')),
        sendMail: jest.fn(),
        isIdle: jest.fn(),
      } as unknown as jest.Mocked<nodemailer.Transporter>;

      // Mock nodemailer to return the failing transporter
      mockNodemailer.createTransport.mockReturnValueOnce(failingTransporter);

      // Create new service instance
      const testModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const testService = testModule.get<EmailService>(EmailService);

      // Act - Should not throw but should handle verification failure gracefully
      await testService.onModuleInit();

      // Assert - verify method should return false when verification fails
      const verifyResult = await testService.verify();
      expect(verifyResult).toBe(false);
    });

    it('should throw error when template loading fails', async () => {
      // Arrange
      mockFs.readdir.mockRejectedValue(
        new Error('Template directory not found'),
      );

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow(
        'Template directory not found',
      );
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should send email successfully', async () => {
      // Arrange
      const emailOptions: EmailOptions = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Test Content</h1>',
      };

      const mockInfo = {
        messageId: 'msg-123',
        envelope: { from: 'noreply@test.com', to: ['test@example.com'] },
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(mockEmailValidator.validate).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: 'test@example.com',
        cc: undefined,
        bcc: undefined,
        subject: 'Test Subject',
        priority: 'normal',
        headers: undefined,
        html: '<h1>Test Content</h1>',
        text: 'Test Content',
        attachments: undefined,
      });

      expect(result).toEqual({
        success: true,
        messageId: 'msg-123',
        envelope: mockInfo.envelope,
      });
    });

    it('should send email with template', async () => {
      // Arrange
      const emailOptions: EmailOptions = {
        to: 'test@example.com',
        subject: 'Test Subject',
        template: 'notification',
        context: { content: 'Hello World' },
      };

      const mockInfo = {
        messageId: 'msg-123',
        envelope: { from: 'noreply@test.com', to: ['test@example.com'] },
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
          html: expect.any(String),
          text: expect.any(String),
        }),
      );

      expect(result.success).toBe(true);
    });

    it('should handle multiple recipients', async () => {
      // Arrange
      const emailOptions: EmailOptions = {
        to: ['test1@example.com', 'test2@example.com'],
        subject: 'Test Subject',
        html: '<h1>Test Content</h1>',
      };

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(mockEmailValidator.validate).toHaveBeenCalledTimes(2);
      expect(mockEmailValidator.validate).toHaveBeenCalledWith(
        'test1@example.com',
      );
      expect(mockEmailValidator.validate).toHaveBeenCalledWith(
        'test2@example.com',
      );
      expect(result.success).toBe(true);
    });

    it('should return error for invalid email addresses', async () => {
      // Arrange
      const emailOptions: EmailOptions = {
        to: 'invalid-email',
        subject: 'Test Subject',
        html: '<h1>Test Content</h1>',
      };

      mockEmailValidator.validate.mockReturnValue(false);

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'Invalid email address: invalid-email',
      });
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('should handle send failures', async () => {
      // Arrange
      const emailOptions: EmailOptions = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Test Content</h1>',
      };

      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(result).toEqual({
        success: false,
        error: 'SMTP error',
      });
    });

    it('should include preview URL for Ethereal emails', async () => {
      // Arrange
      const etherealConfig = {
        ...mockEmailConfig,
        ethereal: { enabled: true },
      };
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'email') return etherealConfig;
        if (key === 'email.defaults.from') return mockEmailConfig.defaults.from;
        return null;
      });

      // Re-initialize with Ethereal
      await service.onModuleInit();

      const emailOptions: EmailOptions = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Test Content</h1>',
      };

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      const result = await service.send(emailOptions);

      // Assert
      expect(result).toEqual({
        success: true,
        messageId: 'msg-123',
        envelope: {},
        previewUrl: 'http://preview.url',
      });
    });
  });

  describe('sendNotification', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should send notification email successfully', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        recipient: 'test@example.com',
        subject: 'Test Notification',
        content: 'This is a test notification',
        metadata: { template: 'notification' },
      });

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      const result = await service.sendNotification(notification);

      // Assert
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Notification',
          priority: 'normal',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('should use default subject when not provided', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        recipient: 'test@example.com',
        subject: null,
        content: 'This is a test notification',
      });

      // Force the subject to be null/undefined
      notification.subject = null;

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      await service.sendNotification(notification);

      // Assert
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Notification',
        }),
      );
    });

    it('should use high priority when specified in metadata', async () => {
      // Arrange
      const notification = TestDataBuilder.createNotification({
        recipient: 'test@example.com',
        subject: 'Urgent Notification',
        content: 'This is urgent',
        metadata: { priority: 'high' },
      });

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      await service.sendNotification(notification);

      // Assert
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'high',
        }),
      );
    });
  });

  describe('verify', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return true when verification succeeds', async () => {
      // Arrange
      mockTransporter.verify.mockResolvedValue(true);

      // Act
      const result = await service.verify();

      // Assert
      expect(result).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it('should return false when verification fails', async () => {
      // Arrange
      mockTransporter.verify.mockRejectedValue(new Error('Connection failed'));

      // Act
      const result = await service.verify();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return idle status when transporter is idle', () => {
      // Arrange
      mockTransporter.isIdle.mockReturnValue(true);

      // Act
      const stats = service.getStats();

      // Assert
      expect(stats).toEqual({
        status: 'idle',
        isEthereal: false,
      });
    });

    it('should return active status when transporter is not idle', () => {
      // Arrange
      mockTransporter.isIdle.mockReturnValue(false);

      // Act
      const stats = service.getStats();

      // Assert
      expect(stats).toEqual({
        status: 'active',
        isEthereal: false,
      });
    });
  });

  describe('htmlToText', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should convert HTML to plain text', async () => {
      // This is testing the private method indirectly through send()
      const emailOptions: EmailOptions = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Title</h1><p>Paragraph with <strong>bold</strong> text.</p>',
      };

      const mockInfo = {
        messageId: 'msg-123',
        envelope: {},
      };

      mockTransporter.sendMail.mockResolvedValue(mockInfo);

      // Act
      await service.send(emailOptions);

      // Assert
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Title Paragraph with bold text.'),
        }),
      );
    });
  });
});
