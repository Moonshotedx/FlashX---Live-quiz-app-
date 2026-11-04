import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminTokenEdge } from '@/lib/auth-edge';

/** Keeps /admin/* behind login using the signed HttpOnly admin cookie (admin API routes also verify on their own). */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const user = await verifyAdminTokenEdge(token);
  const path = request.nextUrl.pathname;
  const isLogin = path === '/admin/login';

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
