import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class WebhookSignatureService {
  generateSignature(
    payload: any,
    secret: string,
    timestamp?: number,
  ): {
    signature: string;
    timestamp: number;
    headers: Record<string, string>;
  } {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const payloadString =
      typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Create signature with timestamp to prevent replay attacks
    const signatureBase = `${ts}.${payloadString}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signatureBase)
      .digest('hex');

    return {
      signature,
      timestamp: ts,
      headers: {
        'X-Webhook-Signature': `v1=${signature}`,
        'X-Webhook-Timestamp': ts.toString(),
        'X-Webhook-ID': crypto.randomUUID(),
      },
    };
  }

  verifySignature(
    payload: any,
    signature: string,
    secret: string,
    timestamp: string | number,
    maxAgeSeconds: number = 300, // 5 minutes
  ): boolean {
    // Check timestamp to prevent replay attacks
    const currentTime = Math.floor(Date.now() / 1000);
    const signatureTime =
      typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;

    if (currentTime - signatureTime > maxAgeSeconds) {
      throw new Error('Webhook timestamp too old');
    }

    // Verify signature
    const payloadString =
      typeof payload === 'string' ? payload : JSON.stringify(payload);

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${signatureTime}.${payloadString}`)
      .digest('hex');

    // Extract version and signature from header (format: v1=signature)
    const parts = signature.split('=');
    const receivedSignature = parts.length === 2 ? parts[1] : signature;

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(receivedSignature),
    );
  }
}
