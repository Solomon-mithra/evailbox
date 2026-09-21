import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted input.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      { status: 400 },
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This item already exists.' } },
      { status: 409 },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Send a valid JSON body.' } },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: 'request_failed',
      type: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed. Please try again.',
      },
    },
    { status: 500 },
  );
}
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (!origin || origin !== new URL(process.env.NEXT_PUBLIC_APP_URL!).origin)
          throw new ApiError(403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
      }
      return await handler(request);
    } catch (error) {
      return failure(error);
    }
  };
}
export async function jsonBody(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 20000)
    throw new ApiError(413, 'TOO_LARGE', 'Request body is too large.');
  const text = await request.text();
  if (text.length > 20000) throw new ApiError(413, 'TOO_LARGE', 'Request body is too large.');
  return JSON.parse(text) as unknown;
}
