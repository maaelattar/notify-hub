import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { EmailService } from './modules/channels/email/services/email.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly emailService: EmailService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('test-email')
  async testEmail() {
    try {
      const result = await this.emailService.send({
        to: 'test@example.com',
        subject: 'Test Email from NotifyHub',
        template: 'notification',
        context: {
          content:
            'This is a test email to verify the email channel is working correctly.',
          notificationId: 'test-' + Date.now(),
          timestamp: new Date(),
        },
      });

      return {
        success: true,
        message: 'Test email sent successfully',
        result: {
          messageId: result.messageId,
          previewUrl: result.previewUrl, // Will show for Ethereal Email in development
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to send test email',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
