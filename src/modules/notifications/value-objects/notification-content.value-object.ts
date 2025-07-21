import { NotificationChannel } from '../enums/notification-channel.enum';

export class InvalidContentError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INVALID_CONTENT',
  ) {
    super(message);
    this.name = 'InvalidContentError';
  }
}

export enum ContentFormat {
  TEXT = 'text',
  HTML = 'html',
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export interface ContentMetadata {
  format: ContentFormat;
  encoding: string;
  wordCount?: number;
  characterCount?: number;
  hasEmoji?: boolean;
  hasUrls?: boolean;
  estimatedReadingTime?: number; // in seconds
  isSanitized?: boolean;
  [key: string]: any;
}

/**
 * NotificationContent Value Object - Encapsulates content with format and behavior
 * Provides domain-specific operations for notification content
 */
export class NotificationContent {
  private constructor(
    private readonly value: string,
    private readonly metadata: ContentMetadata,
  ) {
    this.validate();
  }

  /**
   * Factory method for plain text content
   */
  static text(content: string): NotificationContent {
    const trimmed = content.trim();
    const wordCount = this.calculateWordCount(trimmed);
    const characterCount = trimmed.length;

    return new NotificationContent(trimmed, {
      format: ContentFormat.TEXT,
      encoding: 'utf-8',
      wordCount,
      characterCount,
      hasEmoji: this.containsEmoji(trimmed),
      hasUrls: this.containsUrls(trimmed),
      estimatedReadingTime: this.calculateReadingTime(wordCount),
      isSanitized: false,
    });
  }

  /**
   * Factory method for HTML content
   */
  static html(
    content: string,
    sanitized: boolean = false,
  ): NotificationContent {
    const trimmed = content.trim();

    if (!sanitized && NotificationContent.containsSuspiciousHtml(trimmed)) {
      throw new InvalidContentError(
        'HTML content contains potentially harmful elements',
        'SUSPICIOUS_HTML_CONTENT',
      );
    }

    const textContent = this.stripHtmlTags(trimmed);
    const wordCount = this.calculateWordCount(textContent);

    return new NotificationContent(trimmed, {
      format: ContentFormat.HTML,
      encoding: 'utf-8',
      wordCount,
      characterCount: trimmed.length,
      hasEmoji: this.containsEmoji(textContent),
      hasUrls: this.containsUrls(trimmed),
      estimatedReadingTime: this.calculateReadingTime(wordCount),
      isSanitized: sanitized,
    });
  }

  /**
   * Factory method for Markdown content
   */
  static markdown(content: string): NotificationContent {
    const trimmed = content.trim();
    const textContent = this.stripMarkdown(trimmed);
    const wordCount = this.calculateWordCount(textContent);

    return new NotificationContent(trimmed, {
      format: ContentFormat.MARKDOWN,
      encoding: 'utf-8',
      wordCount,
      characterCount: trimmed.length,
      hasEmoji: this.containsEmoji(textContent),
      hasUrls: this.containsUrls(trimmed),
      estimatedReadingTime: this.calculateReadingTime(wordCount),
      isSanitized: false,
    });
  }

  /**
   * Factory method for JSON content
   */
  static json(content: string | object): NotificationContent {
    let jsonString: string;

    if (typeof content === 'object') {
      jsonString = JSON.stringify(content);
    } else {
      // Validate JSON format
      try {
        JSON.parse(content);
        jsonString = content.trim();
      } catch (error) {
        throw new InvalidContentError(
          'Invalid JSON format',
          'INVALID_JSON_FORMAT',
        );
      }
    }

    return new NotificationContent(jsonString, {
      format: ContentFormat.JSON,
      encoding: 'utf-8',
      characterCount: jsonString.length,
      isSanitized: true, // JSON is inherently safer
    });
  }

  /**
   * Smart factory method that auto-detects format
   */
  static create(
    content: string,
    channel?: NotificationChannel,
  ): NotificationContent {
    const trimmed = content.trim();

    // Channel-specific defaults
    if (channel === NotificationChannel.SMS) {
      return this.text(content); // SMS is always plain text
    }

    // Auto-detect format
    if (this.looksLikeJson(trimmed)) {
      return this.json(trimmed);
    }

    if (this.looksLikeHtml(trimmed)) {
      return this.html(trimmed);
    }

    if (this.looksLikeMarkdown(trimmed)) {
      return this.markdown(trimmed);
    }

    return this.text(trimmed);
  }

  /**
   * Get the raw content value
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Get content metadata
   */
  getMetadata(): ContentMetadata {
    return { ...this.metadata };
  }

  /**
   * Get content format
   */
  getFormat(): ContentFormat {
    return this.metadata.format;
  }

  /**
   * Get character count
   */
  getCharacterCount(): number {
    return this.metadata.characterCount || this.value.length;
  }

  /**
   * Get word count
   */
  getWordCount(): number {
    return this.metadata.wordCount || 0;
  }

  /**
   * Get estimated reading time in seconds
   */
  getEstimatedReadingTime(): number {
    return this.metadata.estimatedReadingTime || 0;
  }

  /**
   * Check if content has emoji
   */
  hasEmoji(): boolean {
    return this.metadata.hasEmoji || false;
  }

  /**
   * Check if content has URLs
   */
  hasUrls(): boolean {
    return this.metadata.hasUrls || false;
  }

  /**
   * Check if content is sanitized
   */
  isSanitized(): boolean {
    return this.metadata.isSanitized || false;
  }

  /**
   * Get preview of content (truncated)
   */
  getPreview(length: number = 100): string {
    const textContent = this.getPlainText();

    if (textContent.length <= length) {
      return textContent;
    }

    // Try to break at word boundary
    const truncated = textContent.substring(0, length);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > length * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Get plain text version (strip formatting)
   */
  getPlainText(): string {
    switch (this.metadata.format) {
      case ContentFormat.HTML:
        return NotificationContent.stripHtmlTags(this.value);
      case ContentFormat.MARKDOWN:
        return NotificationContent.stripMarkdown(this.value);
      case ContentFormat.JSON:
        try {
          const parsed = JSON.parse(this.value);
          return this.extractTextFromJson(parsed);
        } catch {
          return this.value;
        }
      case ContentFormat.TEXT:
      default:
        return this.value;
    }
  }

  /**
   * Check if content is suitable for SMS (length and format)
   */
  isSmsCompatible(): boolean {
    const plainText = this.getPlainText();
    return (
      plainText.length <= 160 && this.metadata.format === ContentFormat.TEXT
    );
  }

  /**
   * Check if content is suitable for given channel
   */
  isCompatibleWith(channel: NotificationChannel): boolean {
    switch (channel) {
      case NotificationChannel.SMS:
        return this.isSmsCompatible();

      case NotificationChannel.EMAIL:
        return true; // Email supports all formats

      case NotificationChannel.WEBHOOK:
        return (
          this.metadata.format === ContentFormat.JSON ||
          this.metadata.format === ContentFormat.TEXT
        );

      case NotificationChannel.PUSH:
        return this.getPlainText().length <= 1000; // Push notification limit

      default:
        return true;
    }
  }

  /**
   * Convert content to specific format
   */
  convertTo(targetFormat: ContentFormat): NotificationContent {
    if (this.metadata.format === targetFormat) {
      return this;
    }

    switch (targetFormat) {
      case ContentFormat.TEXT:
        return NotificationContent.text(this.getPlainText());

      case ContentFormat.HTML:
        return this.convertToHtml();

      case ContentFormat.MARKDOWN:
        return this.convertToMarkdown();

      case ContentFormat.JSON:
        return NotificationContent.json({
          content: this.getPlainText(),
          originalFormat: this.metadata.format,
        });

      default:
        throw new InvalidContentError(
          `Cannot convert to format: ${targetFormat}`,
          'UNSUPPORTED_FORMAT_CONVERSION',
        );
    }
  }

  /**
   * Truncate content to specified length
   */
  truncate(
    maxLength: number,
    preserveWords: boolean = true,
  ): NotificationContent {
    if (this.value.length <= maxLength) {
      return this;
    }

    let truncated: string;

    if (preserveWords) {
      const words = this.value.split(' ');
      truncated = '';

      for (const word of words) {
        if ((truncated + ' ' + word).length > maxLength - 3) {
          break;
        }
        truncated += (truncated ? ' ' : '') + word;
      }

      truncated += '...';
    } else {
      truncated = this.value.substring(0, maxLength - 3) + '...';
    }

    // Create new instance with same format
    switch (this.metadata.format) {
      case ContentFormat.HTML:
        return NotificationContent.html(truncated, this.isSanitized());
      case ContentFormat.MARKDOWN:
        return NotificationContent.markdown(truncated);
      case ContentFormat.JSON:
        return NotificationContent.json(truncated);
      case ContentFormat.TEXT:
      default:
        return NotificationContent.text(truncated);
    }
  }

  /**
   * Equality comparison
   */
  equals(other: NotificationContent): boolean {
    return (
      this.value === other.value &&
      this.metadata.format === other.metadata.format
    );
  }

  /**
   * String representation
   */
  toString(): string {
    return this.value;
  }

  /**
   * JSON representation for serialization
   */
  toJSON(): { value: string; metadata: ContentMetadata } {
    return {
      value: this.value,
      metadata: this.metadata,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: {
    value: string;
    metadata: ContentMetadata;
  }): NotificationContent {
    return new NotificationContent(json.value, json.metadata);
  }

  // Private methods
  private validate(): void {
    if (!this.value && this.value !== '') {
      throw new InvalidContentError(
        'Content value cannot be null or undefined',
        'NULL_CONTENT',
      );
    }

    if (this.value.length > 50000) {
      throw new InvalidContentError(
        'Content exceeds maximum length of 50,000 characters',
        'CONTENT_TOO_LONG',
      );
    }

    // Security validation
    if (!this.isSanitized() && this.containsMaliciousContent(this.value)) {
      throw new InvalidContentError(
        'Content contains potentially harmful elements',
        'MALICIOUS_CONTENT',
      );
    }
  }

  private containsMaliciousContent(content: string): boolean {
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // Event handlers
      /data:text\/html/gi,
      /<iframe\b/gi,
      /<object\b/gi,
      /<embed\b/gi,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(content));
  }

  private convertToHtml(): NotificationContent {
    switch (this.metadata.format) {
      case ContentFormat.TEXT:
        // Simple text to HTML conversion
        const htmlContent = this.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        return NotificationContent.html(htmlContent, true);

      case ContentFormat.MARKDOWN:
        // Basic Markdown to HTML conversion (simplified)
        const html = this.value
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/\n/g, '<br>');
        return NotificationContent.html(html, true);

      default:
        return NotificationContent.html(this.getPlainText(), true);
    }
  }

  private convertToMarkdown(): NotificationContent {
    switch (this.metadata.format) {
      case ContentFormat.HTML:
        // Basic HTML to Markdown conversion (simplified)
        const markdown = this.value
          .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
          .replace(/<em>(.*?)<\/em>/g, '*$1*')
          .replace(/<br>/g, '\n');
        return NotificationContent.markdown(
          NotificationContent.stripHtmlTags(markdown),
        );

      default:
        return NotificationContent.markdown(this.getPlainText());
    }
  }

  private extractTextFromJson(obj: any): string {
    if (typeof obj === 'string') {
      return obj;
    }

    if (typeof obj === 'object' && obj !== null) {
      if (obj.content || obj.message || obj.text) {
        return obj.content || obj.message || obj.text;
      }

      // Extract all string values
      const strings: string[] = [];
      for (const value of Object.values(obj)) {
        if (typeof value === 'string') {
          strings.push(value);
        }
      }
      return strings.join(' ');
    }

    return String(obj);
  }

  // Static helper methods
  private static calculateWordCount(text: string): number {
    if (!text.trim()) return 0;
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  private static calculateReadingTime(wordCount: number): number {
    // Average reading speed: 200 words per minute
    return Math.ceil((wordCount / 200) * 60);
  }

  private static containsEmoji(text: string): boolean {
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    return emojiRegex.test(text);
  }

  private static containsUrls(text: string): boolean {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return urlRegex.test(text);
  }

  private static stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ');
  }

  private static stripMarkdown(markdown: string): string {
    return markdown
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  }

  private static looksLikeJson(content: string): boolean {
    const trimmed = content.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  private static looksLikeHtml(content: string): boolean {
    return /<[^>]+>/.test(content);
  }

  private static looksLikeMarkdown(content: string): boolean {
    const markdownPatterns = [
      /^\s*#{1,6}\s/m, // Headers
      /\*\*.*?\*\*/, // Bold
      /\*.*?\*/, // Italic
      /^\s*[-*+]\s/m, // Lists
      /\[.*?\]\(.*?\)/, // Links
      /```[\s\S]*?```/, // Code blocks
    ];

    return markdownPatterns.some((pattern) => pattern.test(content));
  }

  private static containsSuspiciousHtml(content: string): boolean {
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // Event handlers
      /data:text\/html/gi,
      /<iframe\b/gi,
      /<object\b/gi,
      /<embed\b/gi,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(content));
  }
}
