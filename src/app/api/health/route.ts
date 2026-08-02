import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    environment: env.appEnv,
    timestamp: new Date().toISOString(),
  });
}
