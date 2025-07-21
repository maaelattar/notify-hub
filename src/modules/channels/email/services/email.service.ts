import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as EmailValidator from 'email-validator';
import {
  EmailOptions,
  EmailResult,
  EmailProvider,
} from '../interfaces/email.interface';
import { EmailConfig } from '../interfaces/email-config.interface';
import { Notification } from '../../../notifications/entities/notification.entity';

@Injectable()
export class EmailService implements EmailProvider, OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();
  private isEthereal = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeTransporter();
    await this.loadTemplates();
  }

  /**
   * Initialize email transporter
   */
  private async initializeTransporter() {
    const emailConfig = this.configService.get<EmailConfig>('email')!;

    try {
      // Use Ethereal Email for development if no SMTP configured
      if (emailConfig.ethereal.enabled) {
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: testAccount.smtp.host,
          port: testAccount.smtp.port,
          secure: testAccount.smtp.secure,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        this.isEthereal = true;
        this.logger.log('Using Ethereal Email for testing');
        this.logger.log(`Ethereal user: ${testAccount.user}`);
      } else {
        // Use configured SMTP
        this.transporter = nodemailer.createTransport(emailConfig.transport);
        this.logger.log(
          `Email transporter configured with ${emailConfig.transport.host}`,
        );
      }

      // Verify connection
      await this.verify();
    } catch (error) {
      this.logger.error(
        'Failed to initialize email transporter',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Load email templates
   */
  private async loadTemplates() {
    const templatesPath = path.join(__dirname, '../templates');

    try {
      const files = await fs.readdir(templatesPath);

      for (const file of files) {
        if (file.endsWith('.hbs')) {
          const templateName = path.basename(file, '.hbs');
          const templateContent = await fs.readFile(
            path.join(templatesPath, file),
            'utf-8',
          );

          this.templates.set(templateName, handlebars.compile(templateContent));
          this.logger.debug(`Loaded email template: ${templateName}`);
        }
      }

      // Register common helpers
      this.registerHandlebarsHelpers();

      // Ensure required templates are loaded
      if (!this.templates.has('notification')) {
        this.logger.error('Required email template "notification" not found');
      }

      this.logger.log(`Loaded ${this.templates.size} email templates`);
    } catch (error) {
      this.logger.error(
        'Failed to load email templates - emails may fail',
        error instanceof Error ? error.stack : String(error),
      );
      throw error; // Make template loading failure more explicit
    }
  }

  /**
   * Register Handlebars helpers
   */
  private registerHandlebarsHelpers() {
    // Date formatter
    handlebars.registerHelper('formatDate', (date: Date) => {
      return new Date(date).toLocaleDateString();
    });

    // Conditional helper
    handlebars.registerHelper(
      'ifEquals',
      function (
        arg1: unknown,
        arg2: unknown,
        options: Handlebars.HelperOptions,
      ) {
        return arg1 === arg2 ? options.fn(this) : options.inverse(this);
      },
    );

    // URL encoder
    handlebars.registerHelper('urlEncode', (str: string) => {
      return encodeURIComponent(str);
    });
  }

  /**
   * Send email
   */
  async send(options: EmailOptions): Promise<EmailResult> {
    try {
      // Validate recipients
      const recipients = Array.isArray(options.to) ? options.to : [options.to];
      for (const recipient of recipients) {
        if (!EmailValidator.validate(recipient)) {
          throw new Error(`Invalid email address: ${recipient}`);
        }
      }

      // Prepare email options
      const mailOptions: nodemailer.SendMailOptions = {
        from: this.configService.get<string>('email.defaults.from'),
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        priority: options.priority || 'normal',
        headers: options.headers,
      };

      // Handle template or direct content
      if (options.template && this.templates.has(options.template)) {
        const template = this.templates.get(options.template)!;
        mailOptions.html = template(options.context || {});
        // Generate text version from HTML
        mailOptions.text = this.htmlToText(mailOptions.html);
      } else {
        mailOptions.html = options.html;
        mailOptions.text = options.text || this.htmlToText(options.html || '');
      }

      // Add attachments if any
      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
      }

      // Send email
      this.logger.log(`Sending email to ${recipients.join(', ')}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const info = await this.transporter.sendMail(mailOptions);

      // Prepare result
      const result: EmailResult = {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        messageId: info.messageId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        envelope: info.envelope,
      };

      // Add preview URL for Ethereal
      if (this.isEthereal) {
        result.previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
        this.logger.log(`Preview email at: ${result.previewUrl}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.log(`Email sent successfully: ${info.messageId}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to send email: ${errorMessage}`, errorStack);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send notification as email
   */
  async sendNotification(notification: Notification): Promise<EmailResult> {
    // Prepare email from notification
    const emailOptions: EmailOptions = {
      to: notification.recipient,
      subject: notification.subject || 'Notification',
      template: (notification.metadata?.template as string) || 'notification',
      context: {
        content: notification.content,
        notificationId: notification.id,
        subject: notification.subject,
        timestamp: new Date(),
        metadata: notification.metadata,
      },
    };

    // Handle priority
    if (notification.metadata?.priority === 'high') {
      emailOptions.priority = 'high';
    }

    return this.send(emailOptions);
  }

  /**
   * Verify transporter connection
   */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('Email transporter verified successfully');
      return true;
    } catch (error) {
      this.logger.error(
        'Email transporter verification failed',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    // Simple HTML to text conversion
    return html
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get email statistics (for monitoring)
   */
  getStats() {
    if (this.transporter.isIdle()) {
      return {
        status: 'idle',
        isEthereal: this.isEthereal,
      };
    }

    return {
      status: 'active',
      isEthereal: this.isEthereal,
    };
  }
}
